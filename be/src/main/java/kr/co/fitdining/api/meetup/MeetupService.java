package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.area.MeetupArea;
import kr.co.fitdining.api.meetup.area.MeetupAreaSearch;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.CalculationState;
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
import kr.co.fitdining.api.meetup.dto.MeetupUpdateRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupCalculation;
import kr.co.fitdining.api.meetup.store.MeetupCalculationRepository;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 모임 만들기, 지역 찾기, 정보 수정, 스냅숏. 상태와 역할별 허용 동작은 {@link MeetupPermissions}가 정한다(D-3). 모임 설명과 참여자의
 * 답은 로그에 남기지 않는다(D-8).
 */
@Service
public class MeetupService {

	private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
	/** 투표 중·정함에서도 고칠 수 있는 항목 */
	private static final Set<String> DATE_FIELDS = Set.of("date", "time");

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupCalculationRepository calculations;
	private final AuthUserRepository users;
	private final MeetupPlaces places;
	private final MeetupRequesters requesters;
	private final MeetupQuestionSource questionSource;
	private final Clock clock;

	public MeetupService(MeetupRepository meetups, MeetupProfileRepository profiles,
			MeetupCalculationRepository calculations, AuthUserRepository users, MeetupPlaces places,
			MeetupRequesters requesters, MeetupQuestionSource questionSource, Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.calculations = calculations;
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
		LocalTime time = minutes(request.time());
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
	 * 모임 정보를 고친다(AC-2, AC-22). 대기·결과에서는 모든 항목을, 투표 중·정함에서는 날짜·시간만 고친다. 날짜를
	 * 바꾸거나 비우면 삭제 시각을 다시 계산한다. 이미 남긴 취향은 그대로 둔다.
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 회원일 때(401)
	 * @throws MeetupForbiddenException 모임장이 아닐 때
	 * @throws MeetupConflictException 투표 중·정함에서 날짜·시간 밖의 항목을 고치거나 날짜를 비울 때({@code phase})
	 * @throws InvalidMeetupException 지역이나 업종을 비우거나, 고를 수 없는 지역·날짜·시간이거나, 설명이 길 때
	 */
	@Transactional
	public void update(String code, String userId, MeetupUpdateRequest request) {
		requireActiveUser(userId);
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		Meetup meetup = meetups.findLockedByCode(code).orElseThrow(MeetupNotFoundException::new);
		if (!meetup.hostedBy(userId)) {
			throw new MeetupForbiddenException();
		}
		if (!meetup.infoEditable() && (!DATE_FIELDS.containsAll(request.fields())
				|| request.has("date") && request.date() == null)) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		Instant now = now();
		if (request.has("area") && request.area() == null || request.has("category") && request.category() == null) {
			throw new InvalidMeetupException();
		}
		MeetupArea area = request.has("area") ? selectableArea(request.area())
				: new MeetupArea(meetup.getAreaKind(), meetup.getAreaName());
		MeetupCategory category = request.has("category") ? request.category() : meetup.getCategory();
		LocalDate date = request.has("date") ? request.date() : meetup.getMeetDate();
		LocalTime time = request.has("time") ? minutes(request.time()) : date == null ? null : meetup.getMeetTime();
		if ((request.has("date") || request.has("time")) && !MeetupSchedule.selectable(date, time, now)) {
			throw new InvalidMeetupException();
		}
		Instant expiresAt = Objects.equals(date, meetup.getMeetDate()) ? meetup.getExpiresAt()
				: MeetupSchedule.expiresAt(date, now);
		meetup.edit(area.kind(), area.name(), category, date, time,
				request.has("headcount") ? request.headcount() : meetup.getHeadcount(),
				request.has("description") ? description(request.description()) : meetup.getDescription(),
				expiresAt, now);
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
	 * 모임의 지금 상태(AC-3, AC-4, AC-9, AC-18). 프로필의 취향은 지금 보이는 질문의 답만 담는다. 실행 중인 계산이
	 * 45초를 넘었으면 읽기 전에 실패로 바꾼다(AC-17).
	 *
	 * @param code 모임 코드
	 * @param userId 로그인한 회원. 비회원이면 null이다.
	 * @param cookieToken 모임 쿠키 값. 없으면 null이다.
	 * @throws MeetupNotFoundException 없는 코드일 때
	 */
	@Transactional
	public MeetupSnapshot snapshot(String code, String userId, String cookieToken) {
		Meetup meetup = find(code);
		Instant now = now();
		calculations.failStale(meetup.getMeetupId(), now.minus(MeetupLimits.CALCULATION_STALE), now);
		List<MeetupCalculation> recent = calculations.findByMeetupIdOrderByCalcIdDesc(meetup.getMeetupId());
		MeetupCalculation latest = recent.isEmpty() ? null : recent.getFirst();
		MeetupCalculation success = recent.stream().filter(calc -> calc.getState() == CalculationState.SUCCEEDED)
				.findFirst().orElse(null);
		List<MeetupProfile> joined = profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId());
		boolean outdated = outdated(meetup, joined, success);
		MeetupRequesters.Requester requester = requesters.resolve(meetup, joined, userId, cookieToken);
		MeetupQuestions questions = questionSource.questions(meetup);
		MeetupPermissions.Situation situation = new MeetupPermissions.Situation(meetup.getPhase(), requester.role(),
				requester.hasProfile(), false, latest != null && latest.getState() == CalculationState.RUNNING,
				outdated, meetup.getPollState(), false, requester.convertible());
		MeetupSnapshot.Info info = new MeetupSnapshot.Info(
				new MeetupSnapshot.Area(meetup.getAreaKind(), meetup.getAreaName()), meetup.getCategory(),
				meetup.getMeetDate(), meetup.getMeetTime() == null ? null : meetup.getMeetTime().format(HH_MM),
				meetup.getHeadcount(), meetup.getDescription(),
				users.findById(meetup.getHostUserId()).map(AuthUser::getNickname).orElse(null),
				MeetupSchedule.lastOpenDay(meetup.getExpiresAt()));
		MeetupSnapshot.Me me = new MeetupSnapshot.Me(requester.role(),
				requester.hasProfile() ? requester.profile().getProfileId() : null, userId != null,
				requester.hasProfile() ? reflected(requester.profile(), success) : null,
				requester.convertible() ? Boolean.TRUE : null);
		return new MeetupSnapshot(meetup.getPhase(), false, info, questions, me,
				List.copyOf(MeetupPermissions.allowed(situation)),
				joined.stream().map(profile -> profileView(meetup, profile, questions, success)).toList(),
				pendingCount(meetup, joined),
				latest == null ? null : new MeetupSnapshot.Calculation(latest.getCalcId(), latest.getState(),
						latest.getStartedAt(), latest.getTasteCount(), outdated),
				success == null ? null : success.getCalcId());
	}

	private static MeetupSnapshot.Profile profileView(Meetup meetup, MeetupProfile profile,
			MeetupQuestions questions, MeetupCalculation success) {
		Taste taste = MeetupTasteRules.visibleOnly(profile.taste(), questions);
		return new MeetupSnapshot.Profile(profile.getProfileId(), profile.getName(), profile.getColor(),
				profile.member(), profile.ownedBy(meetup.getHostUserId()), taste.isEmpty() ? null : taste,
				reflected(profile, success));
	}

	/** 마지막으로 성공한 계산에 들어갔고 그 뒤로 취향을 고치지 않았는지(AC-18). 성공한 계산이 없으면 false다. */
	private static boolean reflected(MeetupProfile profile, MeetupCalculation success) {
		return success != null && success.includedProfileIds().contains(profile.getProfileId())
				&& !profile.getTasteUpdatedAt().isAfter(success.getStartedAt());
	}

	/** 마지막으로 성공한 계산 뒤에 취향이나 모임 정보가 바뀌었거나, 그 계산의 프로필이 지워졌는지(AC-18) */
	private static boolean outdated(Meetup meetup, List<MeetupProfile> joined, MeetupCalculation success) {
		if (success == null) {
			return false;
		}
		Set<Long> current = joined.stream().map(MeetupProfile::getProfileId).collect(Collectors.toSet());
		return meetup.getInfoUpdatedAt().isAfter(success.getStartedAt())
				|| joined.stream().anyMatch(profile -> !reflected(profile, success))
				|| !current.containsAll(success.includedProfileIds());
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

	private static LocalTime minutes(LocalTime time) {
		return time == null ? null : time.truncatedTo(ChronoUnit.MINUTES);
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
