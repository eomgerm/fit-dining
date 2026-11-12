package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.MeetupCodes;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupTasteRules;
import kr.co.fitdining.api.meetup.domain.MeetupText;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.exception.MeetupProfileNotFoundException;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupProfileSession;
import kr.co.fitdining.api.meetup.store.MeetupProfileSessionRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로필 만들기·고르기, 취향 수정, 프로필 지우기(AC-5 ~ AC-10, AC-23). 모든 쓰기는 모임 행을 잠그고 상태를 확인한 뒤
 * 고친다(D-4). 이름과 취향은 로그에 남기지 않는다(D-8).
 */
@Service
public class MeetupProfileService {

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupProfileSessionRepository sessions;
	private final MeetupRequesters requesters;
	private final MeetupQuestionSource questions;
	private final AuthUserRepository users;
	private final Clock clock;

	public MeetupProfileService(MeetupRepository meetups, MeetupProfileRepository profiles,
			MeetupProfileSessionRepository sessions, MeetupRequesters requesters, MeetupQuestionSource questions,
			AuthUserRepository users, Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.sessions = sessions;
		this.requesters = requesters;
		this.questions = questions;
		this.users = users;
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * 발급한 모임 쿠키.
	 *
	 * @param profileId 쿠키가 가리키는 프로필
	 * @param token 쿠키 값
	 * @param maxAge 쿠키 수명(D-36)
	 */
	public record Joined(long profileId, String token, Duration maxAge) {
	}

	/**
	 * 프로필과 모임 취향을 만들고 모임 쿠키를 발급한다(AC-5, AC-6, AC-7). 로그인한 회원이면 회원 프로필이다.
	 *
	 * @throws InvalidMeetupException 이름이나 취향 값이 틀렸을 때
	 * @throws MeetupConflictException 이미 참여한 회원, 다 찬 모임, 이미 있는 이름일 때
	 */
	@Transactional
	public Joined create(String code, String userId, ProfileCreateRequest request) {
		String name = MeetupText.profileName(request.name());
		if (name == null) {
			throw new InvalidMeetupException();
		}
		Taste taste = MeetupTasteRules.normalize(request.taste());
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		List<MeetupProfile> joined = profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId());
		if (userId != null && joined.stream().anyMatch(profile -> profile.ownedBy(userId))) {
			throw new MeetupConflictException(Conflict.ALREADY_JOINED);
		}
		if (joined.size() >= MeetupLimits.PROFILE_MAX) {
			throw new MeetupConflictException(Conflict.FULL);
		}
		if (joined.stream().anyMatch(profile -> profile.getName().equals(name))) {
			throw new MeetupConflictException(Conflict.NAME_TAKEN);
		}
		Instant now = now();
		MeetupQuestions visible = questions.questions(meetup);
		MeetupProfile profile = profiles.save(new MeetupProfile(meetup.getMeetupId(), name, freeColor(joined), userId,
				MeetupTasteRules.visibleOnly(taste, visible), now));
		return issue(profile);
	}

	/**
	 * 다른 브라우저에서 자기 프로필을 고른다(AC-8). 비회원 프로필은 누구나, 회원 프로필은 그 회원으로 로그인해야 고른다.
	 *
	 * @throws MeetupProfileNotFoundException 이 모임에 없는 프로필일 때
	 * @throws MeetupForbiddenException 남의 회원 프로필일 때
	 */
	@Transactional
	public Joined select(String code, long profileId, String userId) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		MeetupProfile profile = profiles.findByProfileIdAndMeetupId(profileId, meetup.getMeetupId())
				.orElseThrow(MeetupProfileNotFoundException::new);
		if (profile.member() && !profile.ownedBy(userId)) {
			throw new MeetupForbiddenException();
		}
		return issue(profile);
	}

	/**
	 * 내 취향을 고친다(AC-10). 지금 보이는 질문의 칸만 바꾸고 숨겨진 질문의 칸은 그대로 둔다. 어느 상태에서든 받는다.
	 *
	 * @throws MeetupForbiddenException 요청한 사람에게 프로필이 없을 때
	 */
	@Transactional
	public void updateTaste(String code, String userId, String cookieToken, Taste request) {
		Taste taste = MeetupTasteRules.normalize(request);
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		MeetupProfile profile = requesters.resolve(meetup,
				profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId()), userId, cookieToken).profile();
		if (profile == null) {
			throw new MeetupForbiddenException();
		}
		profile.replaceTaste(MeetupTasteRules.merge(profile.taste(), taste, questions.questions(meetup)), now());
	}

	/**
	 * 모임 쿠키가 가리키는 비회원 프로필을 로그인한 회원의 프로필로 바꾼다(AC-68, D-25). 어느 상태에서든 받는다.
	 *
	 * @throws MeetupConflictException 그 회원에게 이미 이 모임의 프로필이 있을 때({@code already-joined})
	 * @throws MeetupForbiddenException 모임 쿠키가 비회원 프로필을 가리키지 않을 때
	 */
	@Transactional
	public void linkAccount(String code, String userId, String cookieToken) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		List<MeetupProfile> joined = profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId());
		if (joined.stream().anyMatch(profile -> profile.ownedBy(userId))) {
			throw new MeetupConflictException(Conflict.ALREADY_JOINED);
		}
		MeetupRequesters.Requester requester = requesters.resolve(meetup, joined, userId, cookieToken);
		if (!requester.convertible()) {
			throw new MeetupForbiddenException();
		}
		requester.profile().linkAccount(userId, now());
	}

	/**
	 * 모임장이 다른 사람의 프로필을 지운다(AC-23). 그 프로필의 취향, 쿠키 세션, 표가 함께 지워진다.
	 *
	 * @throws MeetupForbiddenException 모임장이 아닐 때
	 * @throws MeetupProfileNotFoundException 이 모임에 없는 프로필일 때
	 * @throws MeetupConflictException 모임장 자신의 프로필일 때
	 */
	@Transactional
	public void remove(String code, String userId, long profileId) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		if (!meetup.hostedBy(userId)) {
			throw new MeetupForbiddenException();
		}
		MeetupProfile profile = profiles.findByProfileIdAndMeetupId(profileId, meetup.getMeetupId())
				.orElseThrow(MeetupProfileNotFoundException::new);
		if (profile.ownedBy(meetup.getHostUserId())) {
			throw new MeetupConflictException(Conflict.HOST_PROFILE);
		}
		profiles.delete(profile);
	}

	/**
	 * 모임 쿠키를 다시 줄 수명(AC-24). 모임을 여는 동안 쿠키가 먼저 사라지지 않게 한다.
	 *
	 * @return 쿠키가 이 모임의 프로필을 가리킬 때만 있다.
	 */
	@Transactional(readOnly = true)
	public Optional<Duration> cookieLifetime(String code, String cookieToken) {
		if (cookieToken == null || cookieToken.isBlank() || !MeetupCodes.wellFormed(code)) {
			return Optional.empty();
		}
		return meetups.findByCode(code).flatMap(meetup -> sessions.findByTokenHash(MeetupRequesters.hash(cookieToken))
				.flatMap(session -> profiles.findByProfileIdAndMeetupId(session.getProfileId(), meetup.getMeetupId()))
				.map(profile -> MeetupLimits.COOKIE_MAX_AGE));
	}

	private Joined issue(MeetupProfile profile) {
		String token = MeetupRequesters.newToken();
		sessions.save(new MeetupProfileSession(profile.getProfileId(), MeetupRequesters.hash(token)));
		return new Joined(profile.getProfileId(), token, MeetupLimits.COOKIE_MAX_AGE);
	}

	private Meetup lock(String code) {
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		return meetups.findLockedByCode(code).orElseThrow(MeetupNotFoundException::new);
	}

	private static int freeColor(List<MeetupProfile> joined) {
		Set<Integer> used = joined.stream().map(MeetupProfile::getColor).collect(Collectors.toSet());
		return IntStream.range(0, MeetupLimits.PROFILE_MAX).filter(color -> !used.contains(color)).findFirst()
				.orElseThrow(() -> new MeetupConflictException(Conflict.FULL));
	}

	/** 로그인했으면 탈퇴하지 않은 회원이어야 한다. 비회원 요청은 확인하지 않는다. */
	private void requireActiveUser(String userId) {
		if (userId != null && !users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	private Instant now() {
		return clock.instant().truncatedTo(ChronoUnit.MICROS);
	}

}
