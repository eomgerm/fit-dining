package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.area.MeetupArea;
import kr.co.fitdining.api.meetup.area.MeetupAreaSearch;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupCodes;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupPermissions;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupSchedule;
import kr.co.fitdining.api.meetup.domain.MeetupTasteRules;
import kr.co.fitdining.api.meetup.domain.MeetupText;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 모임 만들기, 지역 찾기, 스냅숏. 상태와 역할별 허용 동작은 {@link MeetupPermissions}가 정한다(D-3). 모임 설명과 참여자의
 * 답은 로그에 남기지 않는다(D-8).
 */
@Service
public class MeetupService {

	private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final AuthUserRepository users;
	private final MeetupPlaces places;
	private final MeetupRequesters requesters;
	private final MeetupQuestionSource questionSource;
	private final Clock clock;

	public MeetupService(MeetupRepository meetups, MeetupProfileRepository profiles, AuthUserRepository users,
			MeetupPlaces places, MeetupRequesters requesters, MeetupQuestionSource questionSource,
			Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.users = users;
		this.places = places;
		this.requesters = requesters;
		this.questionSource = questionSource;
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * 모임을 만든다(AC-1, AC-2).
	 *
	 * @param userId 로그인한 회원
	 * @param request 형식 검증을 마친 요청
	 * @return 코드와 보일 질문
	 * @throws AuthFailure 탈퇴했거나 없는 회원일 때(401)
	 * @throws InvalidMeetupException 지역을 고를 수 없거나, 날짜·시간을 고를 수 없거나, 설명이 길 때
	 */
	@Transactional
	public MeetupCreateResponse create(String userId, MeetupCreateRequest request) {
		requireActiveUser(userId);
		Instant now = now();
		MeetupArea area = selectableArea(request.area());
		LocalTime time = request.time() == null ? null : request.time().truncatedTo(ChronoUnit.MINUTES);
		if (!MeetupSchedule.selectable(request.date(), time, now)) {
			throw new InvalidMeetupException();
		}
		MeetupCategory category = request.category() == null ? MeetupCategory.RESTAURANT : request.category();
		Meetup meetup = meetups.save(new Meetup(MeetupCodes.generate(), userId, area.kind(), area.name(), category,
				request.date(), time, request.headcount(), description(request.description()),
				MeetupSchedule.expiresAt(request.date(), now), now));
		return new MeetupCreateResponse(meetup.getCode(), questionSource.questions(meetup));
	}

	/**
	 * 장소가 있는 역과 동을 찾는다.
	 *
	 * @param userId 로그인한 회원
	 * @param query 앞뒤 공백을 지운 찾는 말(1~20자)
	 * @throws AuthFailure 탈퇴했거나 없는 회원일 때(401)
	 */
	@Transactional(readOnly = true)
	public MeetupAreasResponse areas(String userId, String query) {
		requireActiveUser(userId);
		return new MeetupAreasResponse(MeetupAreaSearch.find(places.areas(), query).stream()
				.map(area -> new MeetupAreasResponse.Item(area.kind(), area.name())).toList());
	}

	/**
	 * 모임의 지금 상태(AC-3, AC-4, AC-9). 프로필의 취향은 지금 보이는 질문의 답만 담는다.
	 *
	 * @param code 모임 코드
	 * @param userId 로그인한 회원. 비회원이면 null이다.
	 * @param cookieToken 모임 쿠키 값. 없으면 null이다.
	 * @throws MeetupNotFoundException 없는 코드일 때
	 */
	@Transactional(readOnly = true)
	public MeetupSnapshot snapshot(String code, String userId, String cookieToken) {
		Meetup meetup = find(code);
		List<MeetupProfile> joined = profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId());
		MeetupRequesters.Requester requester = requesters.resolve(meetup, joined, userId, cookieToken);
		MeetupQuestions questions = questionSource.questions(meetup);
		MeetupPermissions.Situation situation = new MeetupPermissions.Situation(meetup.getPhase(), requester.role(),
				requester.hasProfile(), false, false, false, null, false, requester.convertible());
		MeetupSnapshot.Info info = new MeetupSnapshot.Info(
				new MeetupSnapshot.Area(meetup.getAreaKind(), meetup.getAreaName()), meetup.getCategory(),
				meetup.getMeetDate(), meetup.getMeetTime() == null ? null : meetup.getMeetTime().format(HH_MM),
				meetup.getHeadcount(), meetup.getDescription(),
				users.findById(meetup.getHostUserId()).map(AuthUser::getNickname).orElse(null),
				MeetupSchedule.lastOpenDay(meetup.getExpiresAt()));
		MeetupSnapshot.Me me = new MeetupSnapshot.Me(requester.role(),
				requester.hasProfile() ? requester.profile().getProfileId() : null, userId != null,
				requester.convertible() ? Boolean.TRUE : null);
		return new MeetupSnapshot(meetup.getPhase(), false, info, questions, me,
				List.copyOf(MeetupPermissions.allowed(situation)),
				joined.stream().map(profile -> profileView(meetup, profile, questions)).toList(),
				pendingCount(meetup, joined));
	}

	private static MeetupSnapshot.Profile profileView(Meetup meetup, MeetupProfile profile,
			MeetupQuestions questions) {
		Taste taste = MeetupTasteRules.visibleOnly(profile.taste(), questions);
		return new MeetupSnapshot.Profile(profile.getProfileId(), profile.getName(), profile.getColor(),
				profile.member(), profile.ownedBy(meetup.getHostUserId()), taste.isEmpty() ? null : taste, false);
	}

	/** 인원을 정했고 남긴 수가 인원보다 적을 때만 남은 수를 준다(AC-29). */
	private static Integer pendingCount(Meetup meetup, List<MeetupProfile> joined) {
		Integer headcount = meetup.getHeadcount();
		return headcount != null && joined.size() < headcount ? headcount - joined.size() : null;
	}

	private Meetup find(String code) {
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		return meetups.findByCode(code).orElseThrow(MeetupNotFoundException::new);
	}

	private MeetupArea selectableArea(MeetupCreateRequest.Area requested) {
		String name = MeetupText.trimToNull(requested.name());
		if (requested.kind() == AreaKind.POINT || name == null) {
			throw new InvalidMeetupException();
		}
		MeetupArea area = new MeetupArea(requested.kind(), name);
		if (!places.areas().contains(area)) {
			throw new InvalidMeetupException();
		}
		return area;
	}

	private static String description(String raw) {
		String description = MeetupText.trimToNull(raw);
		if (description != null && MeetupText.length(description) > MeetupLimits.DESCRIPTION_MAX) {
			throw new InvalidMeetupException();
		}
		return description;
	}

	private void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	/** PostgreSQL은 마이크로초까지만 저장한다. */
	private Instant now() {
		return clock.instant().truncatedTo(ChronoUnit.MICROS);
	}

}
