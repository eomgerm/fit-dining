package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.RejectedExecutionException;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.domain.MeetupCodes;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupTasteRules;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommender;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupCalculation;
import kr.co.fitdining.api.meetup.store.MeetupCalculationRepository;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 추천받기와 계산 작업(AC-15 ~ AC-17, D-10). 요청은 계산 행을 넣고 202로 끝나고, 커밋한 뒤 작업 스레드가 추천기를 한
 * 번 불러 결과를 저장한다. 로그에는 계산 번호와 예외 종류만 남긴다(D-8).
 */
@Slf4j
@Service
public class MeetupCalculationService {

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupCalculationRepository calculations;
	private final MeetupQuestionSource questions;
	private final MeetupRecommender recommender;
	private final MeetupCalculationExecutor executor;
	private final AuthUserRepository users;
	private final TransactionTemplate separately;
	private final Clock clock;

	public MeetupCalculationService(MeetupRepository meetups, MeetupProfileRepository profiles,
			MeetupCalculationRepository calculations, MeetupQuestionSource questions, MeetupRecommender recommender,
			MeetupCalculationExecutor executor, AuthUserRepository users, PlatformTransactionManager transactions,
			Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.calculations = calculations;
		this.questions = questions;
		this.recommender = recommender;
		this.executor = executor;
		this.users = users;
		// 커밋 뒤와 작업 스레드에서는 늘 새 트랜잭션으로 쓴다.
		this.separately = new TransactionTemplate(transactions);
		this.separately.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * 추천받기. 지금 있는 프로필의 취향(보이는 질문의 답만)으로 계산한다. 대기열이 차 있으면 계산은 바로 실패가 되지만
	 * 응답은 그대로 202다(AC-17).
	 *
	 * @throws MeetupForbiddenException 모임장이 아닐 때
	 * @throws MeetupConflictException 계산 중이거나({@code calculating}), 대기·결과 상태가 아니거나 투표를 연 적이
	 *         있을 때({@code phase})
	 */
	@Transactional
	public void start(String code, String userId) {
		requireActiveUser(userId);
		Meetup meetup = lock(code);
		if (!meetup.hostedBy(userId)) {
			throw new MeetupForbiddenException();
		}
		long meetupId = meetup.getMeetupId();
		Instant now = now();
		calculations.failStale(meetupId, now.minus(MeetupLimits.CALCULATION_STALE), now);
		if (calculations.existsByMeetupIdAndState(meetupId, CalculationState.RUNNING)) {
			throw new MeetupConflictException(Conflict.CALCULATING);
		}
		if (!meetup.calculable()) {
			throw MeetupConflictException.phase(meetup.getPhase());
		}
		calculations.deleteFailed(meetupId);
		List<MeetupProfile> joined = profiles.findByMeetupIdOrderByProfileId(meetupId);
		long calcId = calculations.save(new MeetupCalculation(meetupId, now,
				joined.stream().map(MeetupProfile::getProfileId).toList())).getCalcId();
		MeetupRecommender.Input input = input(meetup, joined, questions.questions(meetup));
		TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
			@Override
			public void afterCommit() {
				submit(calcId, meetupId, input);
			}
		});
	}

	private void submit(long calcId, long meetupId, MeetupRecommender.Input input) {
		try {
			executor.execute(() -> run(calcId, meetupId, input));
		} catch (RejectedExecutionException full) {
			log.warn("Meetup calculation rejected: calcId={}, reason=queue-full", calcId);
			fail(calcId);
		}
	}

	private void run(long calcId, long meetupId, MeetupRecommender.Input input) {
		try {
			MeetupRecommendation recommendation = recommender.recommend(input);
			separately.executeWithoutResult(status -> succeed(calcId, meetupId, recommendation));
		} catch (RuntimeException e) {
			log.warn("Meetup calculation failed: calcId={}, reason={}", calcId, e.getClass().getSimpleName());
			fail(calcId);
		}
	}

	/** 그 계산이 아직 실행 중일 때만 결과를 저장하고, 이전 계산 행을 지운다(AC-16). */
	private void succeed(long calcId, long meetupId, MeetupRecommendation recommendation) {
		Optional<Meetup> meetup = meetups.findLockedByMeetupId(meetupId);
		if (meetup.isEmpty() || calculations.succeedIfRunning(calcId, now()) == 0) {
			log.info("Meetup calculation result discarded: calcId={}", calcId);
			return;
		}
		calculations.findById(calcId).orElseThrow().storeResult(recommendation);
		meetup.get().showResult();
		calculations.deleteOthers(meetupId, calcId);
	}

	private void fail(long calcId) {
		try {
			separately.executeWithoutResult(status -> calculations.failIfRunning(calcId, now()));
		} catch (RuntimeException e) {
			log.warn("Meetup calculation not marked failed: calcId={}, reason={}", calcId,
					e.getClass().getSimpleName());
		}
	}

	private static MeetupRecommender.Input input(Meetup meetup, List<MeetupProfile> joined,
			MeetupQuestions visible) {
		return new MeetupRecommender.Input(meetup.getMeetupId(), meetup.getAreaKind(), meetup.getAreaName(),
				meetup.point(),
				meetup.getCategory(), meetup.getMeetDate(), meetup.getMeetTime(), meetup.getDescription(),
				meetup.getParsedConditions(),
				joined.stream().map(profile -> new MeetupRecommender.Member(profile.getProfileId(),
						profile.getUserId(), MeetupTasteRules.visibleOnly(profile.taste(), visible))).toList());
	}

	private Meetup lock(String code) {
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		return meetups.findLockedByCode(code).orElseThrow(MeetupNotFoundException::new);
	}

	private void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	private Instant now() {
		return clock.instant().truncatedTo(ChronoUnit.MICROS);
	}

}
