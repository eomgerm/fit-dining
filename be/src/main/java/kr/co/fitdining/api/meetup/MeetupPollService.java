package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.domain.DecisionMethod;
import kr.co.fitdining.api.meetup.domain.MeetupCodes;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.PollState;
import kr.co.fitdining.api.meetup.dto.PollOpenRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupCalculation;
import kr.co.fitdining.api.meetup.store.MeetupCalculationRepository;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 투표와 정하기(AC-36 ~ AC-42, D-19). 모든 쓰기는 모임 행을 잠그고 상태를 확인한 뒤 고친다(D-4). 계산이 실행 중이면
 * 투표 열기와 정하기는 받지 않는다. 끝난 계산이 투표나 정한 곳을 결과 상태로 덮지 않게 하기 위해서다(D-10).
 */
@Service
public class MeetupPollService {

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupCalculationRepository calculations;
	private final MeetupRequesters requesters;
	private final AuthUserRepository users;
	private final Clock clock;

	public MeetupPollService(MeetupRepository meetups, MeetupProfileRepository profiles,
			MeetupCalculationRepository calculations, MeetupRequesters requesters, AuthUserRepository users,
			Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.calculations = calculations;
		this.requesters = requesters;
		this.users = users;
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * 투표를 연다(AC-36). 투표를 한 번 열면 그 모임은 다시 추천받을 수 없다.
	 *
	 * @throws MeetupForbiddenException 모임장이 아닐 때
	 * @throws MeetupConflictException 계산 중이거나({@code calculating}) 결과 상태가 아닐 때({@code phase})
	 * @throws InvalidMeetupException 후보가 겹치거나 지금 결과에 없는 장소일 때
	 */
	@Transactional
	public void open(String code, String userId, PollOpenRequest request) {
		Meetup meetup = lockAsHost(code, userId);
		requireNotCalculating(meetup);
		if (meetup.getPhase() != MeetupPhase.RESULT || meetup.getPollState() != null) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		List<Long> candidates = request.placeIds();
		if (new HashSet<>(candidates).size() != candidates.size()
				|| !resultPlaceIds(meetup).containsAll(candidates)) {
			throw new InvalidMeetupException();
		}
		meetup.openPoll(candidates, request.anonymous() == null || request.anonymous());
	}

	/**
	 * 투표하거나 표를 바꾼다(AC-37). 표에는 던진 모임 쿠키 세션을 남긴다(D-7).
	 *
	 * @throws MeetupForbiddenException 요청한 사람에게 프로필이 없을 때
	 * @throws MeetupConflictException 투표가 닫혔거나({@code poll-closed}) 연 적이 없을 때({@code phase})
	 * @throws InvalidMeetupException 후보가 아닌 장소일 때
	 */
	@Transactional
	public void vote(String code, String userId, String cookieToken, long placeId) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		MeetupRequesters.Requester requester = requesters.resolve(meetup,
				profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId()), userId, cookieToken);
		if (!requester.hasProfile()) {
			throw new MeetupForbiddenException();
		}
		if (meetup.getPollState() == null) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		if (meetup.getPollState() != PollState.OPEN) {
			throw new MeetupConflictException(Conflict.POLL_CLOSED);
		}
		if (!meetup.pollCandidates().contains(placeId)) {
			throw new InvalidMeetupException();
		}
		requester.profile().vote(placeId, requester.sessionId());
	}

	/**
	 * 마감한다(AC-40). 가장 많은 곳이 하나면 그곳으로 정하고, 동점이면 투표를 닫은 채 모임장의 선택을 기다린다.
	 *
	 * @throws MeetupForbiddenException 모임장이 아닐 때
	 * @throws MeetupConflictException 열린 투표가 없거나({@code phase}) 표가 하나도 없을 때({@code no-votes})
	 */
	@Transactional
	public void close(String code, String userId) {
		Meetup meetup = lockAsHost(code, userId);
		if (meetup.getPollState() != PollState.OPEN) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		MeetupPollTally tally = MeetupPollTally.of(meetup,
				profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId()));
		if (tally.votedCount() == 0) {
			throw new MeetupConflictException(Conflict.NO_VOTES);
		}
		List<Long> leaders = tally.leaders();
		if (leaders.size() == 1) {
			meetup.decide(leaders.getFirst(), DecisionMethod.VOTE, now());
		} else {
			meetup.closeTied(tally.mostVotes());
		}
	}

	/**
	 * 동점으로 닫힌 투표를 다시 연다(AC-40). 이미 받은 표는 그대로다.
	 *
	 * @throws MeetupConflictException 동점으로 닫힌 투표가 아닐 때({@code phase})
	 */
	@Transactional
	public void reopen(String code, String userId) {
		Meetup meetup = lockAsHost(code, userId);
		if (!meetup.reopenable()) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		meetup.reopenPoll();
	}

	/**
	 * 정하거나 바꾼다(AC-41). 결과에서는 결과 안의 장소로, 닫힌 투표에서는 후보 중 하나로, 정한 뒤에는 결과 안의 다른
	 * 장소로 정한다. 동점으로 닫힌 투표에서 고르면 {@code PICK}, 그 밖은 {@code DIRECT}다(D-31).
	 *
	 * @throws MeetupConflictException 계산 중이거나({@code calculating}) 정할 수 없는 상태일 때({@code phase})
	 * @throws InvalidMeetupException 고를 수 없는 장소이거나 지금 정한 곳일 때
	 */
	@Transactional
	public void decide(String code, String userId, long placeId) {
		Meetup meetup = lockAsHost(code, userId);
		requireNotCalculating(meetup);
		Set<Long> choosable = switch (meetup.getPhase()) {
			case RESULT -> resultPlaceIds(meetup);
			case VOTING -> {
				if (meetup.getPollState() != PollState.CLOSED) {
					throw MeetupConflictException.phase(meetup.getPhase());
				}
				yield Set.copyOf(meetup.pollCandidates());
			}
			case DECIDED -> {
				Set<Long> others = new HashSet<>(resultPlaceIds(meetup));
				others.remove(meetup.getDecidedPlaceId());
				yield others;
			}
			case WAITING -> throw MeetupConflictException.phase(meetup.getPhase());
		};
		if (!choosable.contains(placeId)) {
			throw new InvalidMeetupException();
		}
		DecisionMethod method = meetup.getPhase() == MeetupPhase.VOTING && meetup.tiedPoll() ? DecisionMethod.PICK
				: DecisionMethod.DIRECT;
		meetup.decide(placeId, method, now());
	}

	/**
	 * 정하기 취소(AC-41). 투표가 있었으면 닫힌 투표로, 없었으면 결과로 돌아간다.
	 *
	 * @throws MeetupConflictException 정한 곳이 없을 때({@code phase})
	 */
	@Transactional
	public void cancelDecision(String code, String userId) {
		Meetup meetup = lockAsHost(code, userId);
		if (meetup.getPhase() != MeetupPhase.DECIDED) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		meetup.cancelDecision();
	}

	/** 마지막으로 성공한 계산의 장소. 결과 상태에는 늘 있다. */
	private Set<Long> resultPlaceIds(Meetup meetup) {
		List<MeetupRecommendation.Place> places = calculations
				.findFirstByMeetupIdAndStateOrderByCalcIdDesc(meetup.getMeetupId(), CalculationState.SUCCEEDED)
				.map(MeetupCalculation::getResult).orElse(List.of());
		Set<Long> ids = new HashSet<>();
		places.forEach(place -> ids.add(place.placeId()));
		return ids;
	}

	/** 45초를 넘긴 계산은 실패로 바꾼 뒤 본다(AC-17). */
	private void requireNotCalculating(Meetup meetup) {
		Instant now = now();
		calculations.failStale(meetup.getMeetupId(), now.minus(MeetupLimits.CALCULATION_STALE), now);
		if (calculations.existsByMeetupIdAndState(meetup.getMeetupId(), CalculationState.RUNNING)) {
			throw new MeetupConflictException(Conflict.CALCULATING);
		}
	}

	private Meetup lockAsHost(String code, String userId) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		if (!meetup.hostedBy(userId)) {
			throw new MeetupForbiddenException();
		}
		return meetup;
	}

	private Meetup lock(String code) {
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		return meetups.findLockedByCode(code).orElseThrow(MeetupNotFoundException::new);
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
