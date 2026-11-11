package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.domain.FitKind;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupResult;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupResultNotFoundException;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommender;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 실제 PostgreSQL로 추천받기, 계산 작업, 멈춘 계산, 결과 저장과 읽기, 낡은 추천 판정을 확인한다(AC-15 ~ AC-20).
 * 추천기와 작업 스레드는 테스트가 조절하는 것으로 바꾼다. 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupCalculationPersistenceTest.Configuration.class)
class MeetupCalculationPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-calc-test-";
	private static final String HOST = PREFIX + "host";
	private static final String MEMBER = PREFIX + "member";
	private static final long PLACE_ID = 9211;
	private static final Taste TASTE = new Taste(Mood.QUIET, null, null, null, null, null);

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock meetupCalcTestClock() {
			return new MutableClock();
		}

		@Bean
		@Primary
		TestRecommender meetupCalcTestRecommender() {
			return new TestRecommender();
		}

		@Bean
		@Primary
		TestExecutor meetupCalcTestExecutor() {
			return new TestExecutor();
		}
	}

	static final class MutableClock extends Clock {
		volatile Instant instant = NOON;

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return instant;
		}
	}

	/** 장소 하나에 모든 프로필 70점, 그중 {@code misfit}만 30점을 준다. */
	static final class TestRecommender implements MeetupRecommender {
		final AtomicInteger calls = new AtomicInteger();
		volatile CountDownLatch gate;
		volatile RuntimeException failure;
		volatile Input lastInput;
		volatile long misfit = -1;

		@Override
		public MeetupRecommendation recommend(Input input) {
			calls.incrementAndGet();
			lastInput = input;
			CountDownLatch waiting = gate;
			if (waiting != null) {
				try {
					waiting.await(10, TimeUnit.SECONDS);
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
				}
			}
			if (failure != null) {
				throw failure;
			}
			return new MeetupRecommendation(List.of(new MeetupRecommendation.Place(PLACE_ID, 80, List.of(), null,
					input.members().stream().map(member -> new MeetupRecommendation.MemberScore(member.profileId(),
							member.profileId() == misfit ? 30 : 70, false, null)).toList())),
					MeetupRecommendation.Applied.NONE, null);
		}
	}

	static final class TestExecutor extends MeetupCalculationExecutor {
		volatile boolean full;

		@Override
		void execute(Runnable task) {
			if (full) {
				throw new RejectedExecutionException();
			}
			super.execute(task);
		}
	}

	@Autowired
	MeetupService meetupService;

	@Autowired
	MeetupProfileService profileService;

	@Autowired
	MeetupCalculationService calculationService;

	@Autowired
	MeetupResultService resultService;

	@Autowired
	AuthUserRepository users;

	@Autowired
	MutableClock clock;

	@Autowired
	TestRecommender recommender;

	@Autowired
	TestExecutor executor;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		clock.instant = NOON;
		recommender.calls.set(0);
		recommender.gate = null;
		recommender.failure = null;
		recommender.misfit = -1;
		executor.full = false;
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values (9211, 'meetup-calc-test-9211', '계산 테스트', 'RESTAURANT',
				'SEOLLEUNG', '역삼동', 37.5, 127.05)""");
		users.saveAll(List.of(
				new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(MEMBER, MEMBER + "@example.com", "회원도윤", "hash", NOON, "2026-10-23")));
	}

	@AfterEach
	void tearDown() {
		CountDownLatch gate = recommender.gate;
		if (gate != null) {
			gate.countDown();
		}
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id = ?", PLACE_ID);
	}

	private String meetup() {
		return meetupService.create(HOST, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT, null, null, null,
				null)).code();
	}

	private long join(String code, String userId, String name) {
		return profileService.create(code, userId, new ProfileCreateRequest(name, TASTE)).profileId();
	}

	private List<String> states(String code) {
		return jdbc.queryForList("""
				select c.state from meetup_calculations c join meetups m on m.meetup_id = c.meetup_id
				where m.code = ? order by c.calc_id""", String.class, code);
	}

	private String phase(String code) {
		return jdbc.queryForObject("select phase from meetups where code = ?", String.class, code);
	}

	private static void await(BooleanSupplier done) {
		long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
		while (!done.getAsBoolean()) {
			assertThat(System.nanoTime()).as("기다린 상태가 오지 않았다").isLessThan(deadline);
			try {
				Thread.sleep(20);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return;
			}
		}
	}

	private void awaitStates(String code, String... expected) {
		await(() -> states(code).equals(List.of(expected)));
	}

	@Test
	@DisplayName("추천받기_성공하면_결과상태가되고결과와반영여부가보인다")
	void start_success_storesResult() {
		String code = meetup();
		long host = join(code, HOST, "민재");
		long guest = join(code, null, "하린");

		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");

		assertThat(phase(code)).isEqualTo("RESULT");
		assertThat(recommender.calls).hasValue(1);
		assertThat(recommender.lastInput.members()).extracting(MeetupRecommender.Member::profileId)
				.containsExactly(host, guest);
		MeetupSnapshot snapshot = meetupService.snapshot(code, HOST, null);
		assertThat(snapshot.calculation().state()).isEqualTo(CalculationState.SUCCEEDED);
		assertThat(snapshot.calculation().tasteCount()).isEqualTo(2);
		assertThat(snapshot.calculation().startedAt()).isEqualTo(NOON);
		assertThat(snapshot.calculation().outdated()).isFalse();
		assertThat(snapshot.resultCalculationId()).isEqualTo(snapshot.calculation().id());
		assertThat(snapshot.profiles()).allSatisfy(profile -> assertThat(profile.reflected()).isTrue());
		assertThat(snapshot.me().tasteReflected()).isTrue();
		assertThat(snapshot.allowed()).doesNotContain(MeetupAction.CALCULATE);

		MeetupResult result = resultService.result(code);
		assertThat(result.calculationId()).isEqualTo(snapshot.calculation().id());
		assertThat(result.items()).singleElement().satisfies(item -> {
			assertThat(item.rank()).isEqualTo(1);
			assertThat(item.place().id()).isEqualTo(PLACE_ID);
			assertThat(item.fit().kind()).isEqualTo(FitKind.ALL);
			assertThat(item.fit().fitProfileIds()).containsExactly(host, guest);
		});
	}

	@Test
	@DisplayName("추천받기_모임장이아니면_403이다")
	void start_notHost_forbidden() {
		String code = meetup();
		join(code, MEMBER, "도윤");

		assertThatThrownBy(() -> calculationService.start(code, MEMBER)).isInstanceOf(MeetupForbiddenException.class);
		assertThat(states(code)).isEmpty();
	}

	@Test
	@DisplayName("추천받기_취향을남긴사람이모임장뿐이어도_된다")
	void start_hostOnly_accepted() {
		String code = meetup();
		join(code, HOST, "민재");

		calculationService.start(code, HOST);

		awaitStates(code, "SUCCEEDED");
	}

	@Test
	@DisplayName("추천받기_계산중이면_409calculating이다")
	void start_running_conflict() {
		String code = meetup();
		join(code, HOST, "민재");
		recommender.gate = new CountDownLatch(1);
		calculationService.start(code, HOST);

		assertThatThrownBy(() -> calculationService.start(code, HOST))
				.isInstanceOfSatisfying(MeetupConflictException.class,
						e -> assertThat(e.conflict()).isEqualTo(Conflict.CALCULATING));
		assertThat(meetupService.snapshot(code, HOST, null).allowed()).doesNotContain(MeetupAction.CALCULATE);

		recommender.gate.countDown();
		awaitStates(code, "SUCCEEDED");
	}

	@Test
	@DisplayName("추천받기_두요청이동시에와도_계산은하나만시작된다")
	void start_concurrent_onlyOne() throws Exception {
		String code = meetup();
		join(code, HOST, "민재");
		recommender.gate = new CountDownLatch(1);
		CountDownLatch ready = new CountDownLatch(1);
		ExecutorService pool = Executors.newFixedThreadPool(2);
		try {
			List<Future<Boolean>> started = new ArrayList<>();
			for (int i = 0; i < 2; i++) {
				Callable<Boolean> attempt = () -> {
					ready.await();
					try {
						calculationService.start(code, HOST);
						return true;
					} catch (MeetupConflictException e) {
						return false;
					}
				};
				started.add(pool.submit(attempt));
			}
			ready.countDown();
			int accepted = 0;
			for (Future<Boolean> future : started) {
				accepted += future.get(10, TimeUnit.SECONDS) ? 1 : 0;
			}
			assertThat(accepted).isEqualTo(1);
			assertThat(states(code)).containsExactly("RUNNING");
		} finally {
			pool.shutdownNow();
		}
		recommender.gate.countDown();
		awaitStates(code, "SUCCEEDED");
		assertThat(recommender.calls).hasValue(1);
	}

	@Test
	@DisplayName("추천받기_실패하면_실패가되고상태와취향은그대로이며다시추천받을수있다")
	void start_failure_keepsPhaseAndAllowsRetry() {
		String code = meetup();
		join(code, HOST, "민재");
		recommender.failure = new IllegalStateException("추천 실패");

		calculationService.start(code, HOST);
		awaitStates(code, "FAILED");
		assertThat(phase(code)).isEqualTo("WAITING");
		MeetupSnapshot failed = meetupService.snapshot(code, HOST, null);
		assertThat(failed.calculation().state()).isEqualTo(CalculationState.FAILED);
		assertThat(failed.resultCalculationId()).isNull();
		assertThat(failed.profiles().getFirst().taste()).isEqualTo(TASTE);
		assertThat(failed.allowed()).contains(MeetupAction.CALCULATE);

		recommender.failure = null;
		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");
	}

	@Test
	@DisplayName("멈춘계산_45초가지나면_읽을때실패가되고늦게온결과는버린다")
	void stale_failsOnReadAndDiscardsLateResult() {
		String code = meetup();
		join(code, HOST, "민재");
		recommender.gate = new CountDownLatch(1);
		calculationService.start(code, HOST);

		clock.instant = NOON.plusSeconds(45);
		assertThat(meetupService.snapshot(code, HOST, null).calculation().state())
				.isEqualTo(CalculationState.RUNNING);
		clock.instant = NOON.plusSeconds(46);
		assertThat(meetupService.snapshot(code, HOST, null).calculation().state())
				.isEqualTo(CalculationState.FAILED);

		recommender.gate.countDown();
		await(() -> recommender.calls.get() == 1);
		awaitStates(code, "FAILED");
		assertThat(phase(code)).isEqualTo("WAITING");
		assertThatThrownBy(() -> resultService.result(code)).isInstanceOf(MeetupResultNotFoundException.class);
	}

	@Test
	@DisplayName("멈춘계산_새로추천받을때도_실패로바꾸고새계산을시작한다")
	void stale_failsOnStart() {
		String code = meetup();
		join(code, HOST, "민재");
		recommender.gate = new CountDownLatch(1);
		calculationService.start(code, HOST);
		clock.instant = NOON.plusSeconds(46);
		CountDownLatch first = recommender.gate;
		recommender.gate = null;

		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");

		first.countDown();
		await(() -> recommender.calls.get() == 2);
		assertThat(states(code)).containsExactly("SUCCEEDED");
	}

	@Test
	@DisplayName("대기열이차면_계산은바로실패가되고응답은그대로다")
	void queueFull_failsImmediately() {
		String code = meetup();
		join(code, HOST, "민재");
		executor.full = true;

		assertThatCode(() -> calculationService.start(code, HOST)).doesNotThrowAnyException();

		assertThat(states(code)).containsExactly("FAILED");
		assertThat(recommender.calls).hasValue(0);
	}

	@Test
	@DisplayName("다시추천받으면_성공한계산하나만남는다")
	void recalculate_keepsLatestSuccessOnly() {
		String code = meetup();
		join(code, HOST, "민재");
		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");
		long first = meetupService.snapshot(code, HOST, null).resultCalculationId();

		clock.instant = NOON.plusSeconds(60);
		join(code, null, "하린");
		assertThat(meetupService.snapshot(code, HOST, null).allowed()).contains(MeetupAction.CALCULATE);
		calculationService.start(code, HOST);
		await(() -> {
			Long latest = meetupService.snapshot(code, HOST, null).resultCalculationId();
			return latest != null && latest != first;
		});

		assertThat(states(code)).containsExactly("SUCCEEDED");
		assertThat(phase(code)).isEqualTo("RESULT");
	}

	@Test
	@DisplayName("낡은추천_계산뒤에취향을고치거나들어오면_반영되지않은것으로보인다")
	void outdated_afterTasteChangeOrNewProfile() {
		String code = meetup();
		join(code, HOST, "민재");
		profileService.create(code, null, new ProfileCreateRequest("하린", TASTE));
		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");

		clock.instant = NOON.plusSeconds(60);
		long late = join(code, MEMBER, "도윤");

		MeetupSnapshot host = meetupService.snapshot(code, HOST, null);
		assertThat(host.calculation().outdated()).isTrue();
		assertThat(host.profiles()).filteredOn(profile -> profile.id() == late)
				.singleElement().satisfies(profile -> assertThat(profile.reflected()).isFalse());
		assertThat(host.me().tasteReflected()).isTrue();
		assertThat(meetupService.snapshot(code, MEMBER, null).me().tasteReflected()).isFalse();
		assertThat(resultService.result(code).items().getFirst().fit().kind()).isEqualTo(FitKind.COUNT);
	}

	@Test
	@DisplayName("낡은추천_계산에들어간프로필을지우면_낡고결과에서빠진다")
	void outdated_afterRemovingIncludedProfile() {
		String code = meetup();
		join(code, HOST, "민재");
		long guest = join(code, MEMBER, "도윤");
		recommender.misfit = guest;
		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");
		assertThat(resultService.result(code).items().getFirst().fit().misfitProfileIds()).containsExactly(guest);

		profileService.remove(code, HOST, guest);

		assertThat(meetupService.snapshot(code, HOST, null).calculation().outdated()).isTrue();
		MeetupResult.Item item = resultService.result(code).items().getFirst();
		assertThat(item.fit().kind()).isEqualTo(FitKind.ALL);
		assertThat(item.fit().misfitProfileIds()).isNull();
	}

	@Test
	@DisplayName("결과_성공한계산이없으면_404다")
	void result_none_notFound() {
		String code = meetup();

		assertThatThrownBy(() -> resultService.result(code)).isInstanceOf(MeetupResultNotFoundException.class);
	}

	@Test
	@DisplayName("추천받기_투표를연적이있으면_409phase와지금상태다")
	void start_afterPoll_phaseConflict() {
		String code = meetup();
		join(code, HOST, "민재");
		calculationService.start(code, HOST);
		awaitStates(code, "SUCCEEDED");

		jdbc.update("""
				update meetups set poll_state = 'CLOSED', poll_anonymous = true, poll_place_ids = array[9211]::bigint[],
				phase = 'VOTING' where code = ?""", code);

		assertThatThrownBy(() -> calculationService.start(code, HOST))
				.isInstanceOfSatisfying(MeetupConflictException.class, e -> {
					assertThat(e.conflict()).isEqualTo(Conflict.PHASE);
					assertThat(e.phase()).isEqualTo(MeetupPhase.VOTING);
				});
	}

}
