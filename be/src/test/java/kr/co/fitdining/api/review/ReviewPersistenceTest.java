package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;
import kr.co.fitdining.api.review.exception.InvalidVisitDateException;
import kr.co.fitdining.api.review.store.ReviewRepository;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL(Testcontainers)과 V4 마이그레이션으로 리뷰 저장, 중복 금지, 커서 페이지, 인덱스 사용을 확인한다.
 * 컨테이너는 다른 통합 테스트와 함께 쓰므로 리뷰와 이 테스트가 만든 사용자는 앞뒤로 지운다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(ReviewPersistenceTest.Configuration.class)
class ReviewPersistenceTest extends PostgresTestSupport {

	/** 2026-10-21 12:00:00.123456789 KST. 나노초가 있어 마이크로초 절사를 확인할 수 있다. */
	private static final Instant NOON = Instant.parse("2026-10-21T03:00:00.123456789Z");
	private static final String USER_PREFIX = "review-test-";
	private static final String PASSWORD = "review-test-password1";
	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	@DynamicPropertySource
	static void placeMock(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "true");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock reviewTestClock() {
			return new MutableClock();
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

	@Autowired
	ReviewService service;

	@Autowired
	ReviewRepository reviews;

	@Autowired
	AuthUserRepository users;

	@Autowired
	AuthUseCases auth;

	@Autowired
	PasswordHasher passwords;

	@Autowired
	MutableClock clock;

	@Autowired
	UserService userService;

	@Value("${local.server.port}")
	int port;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		clock.instant = NOON;
	}

	@AfterEach
	void cleanUp() {
		JdbcTemplate app = new JdbcTemplate(appSource());
		app.update("delete from review_reason_tags");
		app.update("delete from reviews");
		app.update("delete from auth_refresh_tokens where user_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_users where id like ?", USER_PREFIX + "%");
	}

	/** 작성자 n명을 만든다. 같은 장소·같은 날 리뷰는 사람마다 하나라 페이지 시험에 여러 명이 필요하다. */
	private List<String> createUsers(int count) {
		String hash = passwords.hash(PASSWORD);
		List<AuthUser> created = IntStream.range(0, count)
				.mapToObj(i -> new AuthUser(USER_PREFIX + i, USER_PREFIX + i + "@example.com", "리뷰테스트" + i, hash,
						NOON, "2026-10-23"))
				.toList();
		users.saveAll(created);
		return created.stream().map(AuthUser::getId).toList();
	}

	private void withdrawAccount(String userId) {
		userService.withdraw(userId, new AuthUseCases.Identity(userId, null, null, 0, 0));
	}

	/** 시계 기준 KST 오늘 방문, 모든 업종에 노출되는 좋았어요 태그 하나 */
	private ReviewCreateRequest body(String description) {
		return request(LocalDate.ofInstant(clock.instant, SEOUL), List.of("QUIET_GOOD"), description);
	}

	private static ReviewCreateRequest request(LocalDate visitedAt, List<String> tagCodes, String description) {
		return new ReviewCreateRequest(visitedAt, tagCodes, false, description, null);
	}

	private int count(String table) {
		return jdbc.queryForObject("select count(*) from " + table, Integer.class);
	}

	@Nested
	@DisplayName("등록")
	class Create {

		@Test
		@DisplayName("등록_KST자정직후면_KST오늘을방문일로받고작성시각은마이크로초로자른다")
		void create_justAfterMidnightKst_acceptsKstTodayAndTruncatesMicros() {
			String user = createUsers(1).getFirst();
			clock.instant = Instant.parse("2026-10-21T15:30:00.123456789Z");

			service.create(1, user, request(LocalDate.of(2026, 10, 22), List.of("QUIET_GOOD"), "좋았어요"));

			Map<String, Object> row = jdbc.queryForMap("select visit_date, created_at, revisit_intent from reviews");
			assertThat(row.get("visit_date").toString()).isEqualTo("2026-10-22");
			assertThat(((java.sql.Timestamp) row.get("created_at")).toInstant())
					.isEqualTo(Instant.parse("2026-10-21T15:30:00.123456Z"));
			assertThat(row.get("revisit_intent")).isEqualTo(false);
			ReviewItem item = service.list(1, null).items().getFirst();
			assertThat(item.createdAt().toString()).isEqualTo("2026-10-22T00:30:00.123456+09:00");
		}

		@Test
		@DisplayName("등록_공백뿐인본문이면_본문없이저장한다")
		void create_blankDescription_storedWithoutDescription() {
			String user = createUsers(1).getFirst();

			service.create(1, user, body(" \n "));

			assertThat(service.list(1, null).items().getFirst().description()).isNull();
		}

		@Test
		@DisplayName("등록_같은사용자장소날짜로두번_두번째는중복예외이고한건만남는다")
		void create_sameUserPlaceDate_secondIsDuplicate() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body("첫 번째"));

			assertThatThrownBy(() -> service.create(1, user, body("두 번째")))
					.isInstanceOf(DuplicateReviewException.class);
			assertThat(service.list(1, null).totalCount()).isEqualTo(1);
		}

		@Test
		@DisplayName("등록_다른장소나다른날이면_모두저장한다")
		void create_otherPlaceOrDate_saved() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body(null));
			service.create(2, user, body(null));
			clock.instant = NOON.plusSeconds(24 * 60 * 60);

			assertThatCode(() -> service.create(1, user, body(null))).doesNotThrowAnyException();
			assertThat(service.list(1, null).totalCount()).isEqualTo(2);
		}

		@Test
		@DisplayName("등록_같은날리뷰를삭제했으면_다시쓸수있다")
		void create_afterSoftDelete_allowedAgain() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body("지울 리뷰"));
			jdbc.update("update reviews set deleted_at = now()");

			assertThatCode(() -> service.create(1, user, body("다시 쓴 리뷰"))).doesNotThrowAnyException();
			assertThat(service.list(1, null).items()).extracting(ReviewItem::description).containsExactly("다시 쓴 리뷰");
		}

		@Test
		@DisplayName("등록_같은요청이동시에두번오면_한건만저장된다")
		void create_concurrentSameVisit_onlyOneSaved() throws Exception {
			String user = createUsers(1).getFirst();
			CountDownLatch start = new CountDownLatch(1);
			Callable<Boolean> attempt = () -> {
				start.await();
				try {
					service.create(1, user, body(null));
					return true;
				} catch (DuplicateReviewException e) {
					return false;
				}
			};
			ExecutorService pool = Executors.newFixedThreadPool(2);
			try {
				List<Future<Boolean>> results = List.of(pool.submit(attempt), pool.submit(attempt));
				start.countDown();
				List<Boolean> saved = new ArrayList<>();
				for (Future<Boolean> result : results) {
					saved.add(result.get());
				}
				assertThat(saved).containsExactlyInAnyOrder(true, false);
			} finally {
				pool.shutdownNow();
			}
			assertThat(jdbc.queryForObject("select count(*) from reviews", Integer.class)).isEqualTo(1);
		}
	}

	@Nested
	@DisplayName("방문일과 이유 태그")
	class VisitDateAndTags {

		private static final LocalDate TODAY = LocalDate.of(2026, 10, 21);

		@Test
		@DisplayName("등록_방문일태그재방문의사금액을_리뷰와함께저장한다")
		void create_storesVisitDateTagsRevisitAndSpent() {
			String user = createUsers(1).getFirst();

			long reviewId = service.create(1, user, new ReviewCreateRequest(TODAY.minusDays(3),
					List.of("QUIET_GOOD", "SHORT_WAIT_BAD"), true, null, 1_000_000)).reviewId();

			Map<String, Object> row = jdbc.queryForMap(
					"select visit_date, revisit_intent, spent_per_person from reviews where review_id = ?", reviewId);
			assertThat(row.get("visit_date").toString()).isEqualTo("2026-10-18");
			assertThat(row).containsEntry("revisit_intent", true).containsEntry("spent_per_person", 1_000_000);
			assertThat(jdbc.queryForList("select code from review_reason_tags where review_id = ? order by code",
					String.class, reviewId)).containsExactly("QUIET_GOOD", "SHORT_WAIT_BAD");
		}

		@Test
		@DisplayName("등록_방문일이오늘과한달전이면_저장하고_그밖이면_예외이고저장하지않는다")
		void create_visitDateBoundaries() {
			List<String> authors = createUsers(2);

			service.create(1, authors.get(0), request(TODAY, List.of("QUIET_GOOD"), null));
			service.create(1, authors.get(0), request(TODAY.minusMonths(1), List.of("QUIET_GOOD"), null));
			for (LocalDate outside : List.of(TODAY.plusDays(1), TODAY.minusMonths(1).minusDays(1))) {
				assertThatThrownBy(() -> service.create(1, authors.get(1), request(outside, List.of("QUIET_GOOD"), null)))
						.isInstanceOf(InvalidVisitDateException.class);
			}

			assertThat(count("reviews")).isEqualTo(2);
		}

		@Test
		@DisplayName("등록_태그가선택규칙에맞지않으면_예외이고아무것도저장하지않는다")
		void create_invalidTags_savesNothing() {
			String user = createUsers(1).getFirst();
			List<List<String>> invalid = List.of(
					List.of("SHORT_WAIT_BAD"),
					List.of("QUIET_GOOD", "LIVELY_BAD"),
					List.of("PURPOSE_WORK_GOOD"),
					List.of("NOT_A_TAG"));

			for (List<String> tagCodes : invalid) {
				assertThatThrownBy(() -> service.create(1, user, request(TODAY, tagCodes, null)))
						.as(tagCodes.toString()).isInstanceOf(InvalidReasonTagsException.class);
			}

			assertThat(count("reviews")).isZero();
			assertThat(count("review_reason_tags")).isZero();
		}

		@Test
		@DisplayName("등록_같은날두번째가중복이면_그태그도남지않는다")
		void create_duplicate_leavesNoTags() {
			String user = createUsers(1).getFirst();
			service.create(1, user, request(TODAY.minusDays(2), List.of("QUIET_GOOD"), null));

			assertThatThrownBy(() -> service.create(1, user,
					request(TODAY.minusDays(2), List.of("COZY_GOOD", "SHORT_WAIT_BAD"), null)))
					.isInstanceOf(DuplicateReviewException.class);

			assertThat(jdbc.queryForList("select code from review_reason_tags", String.class))
					.containsExactly("QUIET_GOOD");
		}

		@Test
		@DisplayName("등록_다른날로쓰면_오늘리뷰가있어도저장한다")
		void create_otherVisitDate_allowedWithTodayReview() {
			String user = createUsers(1).getFirst();
			service.create(1, user, request(TODAY, List.of("QUIET_GOOD"), null));

			assertThatCode(() -> service.create(1, user, request(TODAY.minusDays(1), List.of("QUIET_GOOD"), null)))
					.doesNotThrowAnyException();
			assertThat(service.reviewForm(1, user).reviewedDates()).containsExactly(TODAY.minusDays(1), TODAY);
		}
	}

	@Nested
	@DisplayName("목록")
	class ListReviews {

		@Test
		@DisplayName("목록_같은시각의리뷰가45건이면_20건20건5건으로중복없이나뉘고리뷰수는첫페이지에만있다")
		void list_45ReviewsSameCreatedAt_pagesWithoutOverlap() {
			for (String user : createUsers(45)) {
				service.create(1, user, body(null));
			}

			ReviewListResponse first = service.list(1, null);
			ReviewListResponse second = service.list(1, first.nextCursor());
			ReviewListResponse third = service.list(1, second.nextCursor());

			assertThat(first.totalCount()).isEqualTo(45);
			assertThat(second.totalCount()).isNull();
			assertThat(third.totalCount()).isNull();
			assertThat(first.items()).hasSize(20);
			assertThat(second.items()).hasSize(20);
			assertThat(third.items()).hasSize(5);
			assertThat(third.nextCursor()).isNull();
			List<Long> ids = new ArrayList<>();
			for (ReviewListResponse page : List.of(first, second, third)) {
				page.items().forEach(item -> ids.add(item.reviewId()));
			}
			assertThat(ids).doesNotHaveDuplicates().hasSize(45).isSortedAccordingTo((a, b) -> Long.compare(b, a));
		}

		@Test
		@DisplayName("목록_작성시각이다르면_최신이먼저다")
		void list_differentCreatedAt_newestFirst() {
			List<String> authors = createUsers(2);
			service.create(1, authors.get(0), body("먼저"));
			clock.instant = NOON.plusSeconds(60);
			service.create(1, authors.get(1), body("나중"));

			assertThat(service.list(1, null).items()).extracting(ReviewItem::description).containsExactly("나중", "먼저");
		}

		@Test
		@DisplayName("목록_정확히20건이면_다음커서가없다")
		void list_exactly20_noNextCursor() {
			for (String user : createUsers(20)) {
				service.create(1, user, body(null));
			}

			ReviewListResponse page = service.list(1, null);

			assertThat(page.items()).hasSize(20);
			assertThat(page.nextCursor()).isNull();
		}

		@Test
		@DisplayName("목록_리뷰가없으면_빈목록과0이다")
		void list_noReviews_emptyAndZero() {
			ReviewListResponse page = service.list(1, null);

			assertThat(page.totalCount()).isZero();
			assertThat(page.items()).isEmpty();
			assertThat(page.nextCursor()).isNull();
		}

		@Test
		@DisplayName("목록_삭제한리뷰는_목록과리뷰수에서빠진다")
		void list_deleted_excluded() {
			List<String> authors = createUsers(2);
			for (String user : authors) {
				service.create(1, user, body(user));
			}
			jdbc.update("update reviews set deleted_at = now() where user_id = ?", authors.get(0));

			ReviewListResponse page = service.list(1, null);

			assertThat(page.totalCount()).isEqualTo(1);
			assertThat(page.items()).extracting(ReviewItem::description).containsExactly(authors.get(1));
		}

		@Test
		@DisplayName("목록_다른장소의리뷰는_보이지않는다")
		void list_otherPlace_notShown() {
			String user = createUsers(1).getFirst();
			service.create(2, user, body(null));

			assertThat(service.list(1, null).totalCount()).isZero();
		}
	}

	@Nested
	@DisplayName("작성 화면 데이터")
	class ReviewForm {

		private static final long CAFE = 3;

		@Test
		@DisplayName("작성화면_카페면_장소와방문일범위와카페태그를돌려준다")
		void reviewForm_cafe_returnsPlaceDatesAndTags() {
			String user = createUsers(1).getFirst();

			ReviewFormResponse form = service.reviewForm(CAFE, user);

			assertThat(form.place().categoryGroup()).isEqualTo(CategoryGroup.CAFE);
			assertThat(form.visitDate().min()).isEqualTo(LocalDate.of(2026, 9, 21));
			assertThat(form.visitDate().max()).isEqualTo(LocalDate.of(2026, 10, 21));
			assertThat(form.visitDate().defaultDate()).isEqualTo(LocalDate.of(2026, 10, 21));
			assertThat(form.tags().good()).hasSize(11);
			assertThat(form.tags().bad()).hasSize(11);
			assertThat(form.tags().good().getFirst().group()).isEqualTo("NOISE");
			assertThat(form.writable()).isTrue();
		}

		@Test
		@DisplayName("작성화면_이미쓴날짜는_내가범위안에남긴리뷰만이다")
		void reviewForm_reviewedDates_ownActiveInRange() {
			List<String> authors = createUsers(2);
			String me = authors.get(0);
			clock.instant = Instant.parse("2026-09-10T03:00:00Z");
			service.create(CAFE, me, body("범위 밖"));
			clock.instant = Instant.parse("2026-10-15T03:00:00Z");
			service.create(CAFE, me, body("지운 리뷰"));
			jdbc.update("update reviews set deleted_at = now() where visit_date = date '2026-10-15'");
			clock.instant = NOON;
			service.create(CAFE, me, body("오늘"));
			service.create(CAFE, authors.get(1), body("다른 사람"));
			service.create(4, me, body("다른 장소"));

			assertThat(service.reviewForm(CAFE, me).reviewedDates()).containsExactly(LocalDate.of(2026, 10, 21));
		}

		@Test
		@DisplayName("작성화면과등록_없는장소면_예외이고저장하지않는다")
		void unknownPlace_throwsAndSavesNothing() {
			String user = createUsers(1).getFirst();

			assertThatThrownBy(() -> service.reviewForm(999, user)).isInstanceOf(PlaceNotFoundException.class);
			assertThatThrownBy(() -> service.create(999, user, body(null))).isInstanceOf(PlaceNotFoundException.class);
			assertThat(jdbc.queryForObject("select count(*) from reviews", Integer.class)).isZero();
		}

		@Test
		@DisplayName("작성화면_탈퇴했거나없는사용자면_401이다")
		void reviewForm_withdrawnOrMissingUser_unauthorized() {
			String user = createUsers(1).getFirst();
			withdrawAccount(user);

			assertThatThrownBy(() -> service.reviewForm(CAFE, user))
					.isInstanceOfSatisfying(AuthFailure.class, failure -> assertThat(failure.status()).isEqualTo(401));
			assertThatThrownBy(() -> service.reviewForm(CAFE, USER_PREFIX + "missing")).isInstanceOf(AuthFailure.class);
		}
	}

	@Nested
	@DisplayName("회원 탈퇴")
	class Withdrawal {

		@Test
		@DisplayName("회원탈퇴_탈퇴해도_그회원리뷰는목록과리뷰수에남고행은바뀌지않는다")
		void userWithdraw_keepsAuthorReviews() {
			List<String> authors = createUsers(2);
			service.create(1, authors.get(0), body("탈퇴자 리뷰"));
			service.create(1, authors.get(1), body("다른 사람 리뷰"));
			String select = "select deleted_at, updated_at from reviews where user_id = ?";
			Map<String, Object> before = jdbc.queryForMap(select, authors.get(0));
			clock.instant = NOON.plusSeconds(60);

			withdrawAccount(authors.get(0));

			assertThat(users.existsByIdAndDeletedAtIsNull(authors.get(0))).isFalse();
			ReviewListResponse page = service.list(1, null);
			assertThat(page.totalCount()).isEqualTo(2);
			assertThat(page.items()).extracting(ReviewItem::description).containsExactly("다른 사람 리뷰", "탈퇴자 리뷰");
			assertThat(before.get("deleted_at")).isNull();
			assertThat(jdbc.queryForMap(select, authors.get(0))).isEqualTo(before);
		}

		@Test
		@DisplayName("등록_탈퇴했거나없는사용자면_401이고저장하지않는다")
		void create_withdrawnOrMissingAuthor_unauthorized() {
			String user = createUsers(1).getFirst();
			jdbc.update("update auth_users set deleted_at = now() where id = ?", user);

			assertThatThrownBy(() -> service.create(1, user, body(null)))
					.isInstanceOfSatisfying(AuthFailure.class, failure -> assertThat(failure.status()).isEqualTo(401));
			assertThatThrownBy(() -> service.create(1, USER_PREFIX + "missing", body(null)))
					.isInstanceOf(AuthFailure.class);
			assertThat(jdbc.queryForObject("select count(*) from reviews", Integer.class)).isZero();
		}

		/** 같은 사람이 탈퇴한 뒤 다시 가입하면 새 계정(새 id)이다. 회원 테이블을 고치지 않고 새 id 사용자로 확인한다(D-38). */
		@Test
		@DisplayName("탈퇴뒤_다시가입한새계정은_같은장소같은날에쓸수있고예전리뷰도남는다")
		void withdraw_rejoinedAsNewAccount_canWriteSamePlaceAndDate() {
			List<String> accounts = createUsers(2);
			service.create(1, accounts.get(0), body("탈퇴 전 리뷰"));
			withdrawAccount(accounts.get(0));

			assertThatCode(() -> service.create(1, accounts.get(1), body("재가입 뒤 리뷰"))).doesNotThrowAnyException();
			assertThat(service.list(1, null).items()).extracting(ReviewItem::description)
					.containsExactly("재가입 뒤 리뷰", "탈퇴 전 리뷰");
		}
	}

	@Nested
	@DisplayName("인덱스")
	class Indexes {

		/**
		 * 시험 데이터가 적으면 PostgreSQL이 순차 스캔을 고르므로 순차 스캔을 끄고, 이 쿼리가 목록 인덱스를 탈 수 있는지와
		 * 정렬을 인덱스가 맡는지(Sort 노드 없음) 본다.
		 */
		private String explain(String sql, Map<String, Object> params) throws Exception {
			try (Connection connection = appSource().getConnection()) {
				try (Statement statement = connection.createStatement()) {
					statement.execute("SET enable_seqscan = off");
				}
				DataSource single = new SingleConnectionDataSource(connection, true);
				List<String> plan = new NamedParameterJdbcTemplate(single)
						.queryForList("EXPLAIN " + sql, params, String.class);
				return String.join("\n", plan);
			}
		}

		@Test
		@DisplayName("첫페이지_목록인덱스를타고_정렬하지않는다")
		void firstPage_usesListIndexWithoutSort() throws Exception {
			String plan = explain(ReviewRepository.FIRST_PAGE, Map.of("placeId", 1L, "limit", 21));

			assertThat(plan).contains("idx_reviews_place_id_created_at_review_id").doesNotContain("Sort");
		}

		@Test
		@DisplayName("다음페이지_목록인덱스를타고_정렬하지않는다")
		void pageAfter_usesListIndexWithoutSort() throws Exception {
			String plan = explain(ReviewRepository.PAGE_AFTER, Map.of("placeId", 1L,
					"createdAt", java.sql.Timestamp.from(NOON), "reviewId", 100L, "limit", 21));

			assertThat(plan).contains("idx_reviews_place_id_created_at_review_id").doesNotContain("Sort");
		}

		@Test
		@DisplayName("이미쓴날짜_중복금지인덱스를탄다")
		void reviewedDates_usesDuplicateVisitIndex() throws Exception {
			String plan = explain(ReviewRepository.REVIEWED_DATES, Map.of("userId", USER_PREFIX + "0", "placeId", 3L,
					"from", java.sql.Date.valueOf("2026-09-21")));

			assertThat(plan).contains("uk_reviews_user_id_place_id_visit_date");
		}
	}

	@Nested
	@DisplayName("HTTP")
	class Http {

		private final HttpClient client = HttpClient.newHttpClient();
		private final JsonMapper mapper = JsonMapper.builder().build();

		private HttpResponse<String> send(String method, String path, String token, String body) throws Exception {
			HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
			if (token != null) {
				builder.header("Authorization", "Bearer " + token);
			}
			if (body != null) {
				builder.header("Content-Type", "application/json");
			}
			builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
					: HttpRequest.BodyPublishers.ofString(body));
			return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
		}

		private static String json(String visitedAt, String description) {
			return "{\"visitedAt\":\"" + visitedAt + "\",\"tagCodes\":[\"QUIET_GOOD\",\"SHORT_WAIT_BAD\"],"
					+ "\"revisitIntent\":true,\"description\":\"" + description + "\",\"spentPerPerson\":15000}";
		}

		@Test
		@DisplayName("등록_로그인한토큰으로_201이고목록맨위에보이며같은날두번째는409다")
		void create_loggedIn_createdShownAndSecondConflicts() throws Exception {
			String user = createUsers(1).getFirst();
			String token = auth.login(USER_PREFIX + "0@example.com", PASSWORD, "127.0.0.1").accessToken();
			String path = "/api/v1/places/1/reviews";

			HttpResponse<String> created = send("POST", path, token, json("2026-10-18", "직접 등록"));
			HttpResponse<String> duplicate = send("POST", path, token, json("2026-10-18", "두 번째"));
			JsonNode page = mapper.readTree(send("GET", path, null, null).body());

			assertThat(created.statusCode()).isEqualTo(201);
			assertThat(duplicate.statusCode()).isEqualTo(409);
			assertThat(page.get("totalCount").asInt()).isEqualTo(1);
			assertThat(page.get("items").get(0).get("description").asString()).isEqualTo("직접 등록");
			Map<String, Object> row = jdbc.queryForMap(
					"select user_id, visit_date, revisit_intent, spent_per_person from reviews");
			assertThat(row).containsEntry("user_id", user).containsEntry("revisit_intent", true)
					.containsEntry("spent_per_person", 15000);
			assertThat(row.get("visit_date").toString()).isEqualTo("2026-10-18");
			assertThat(jdbc.queryForList("select code from review_reason_tags order by code", String.class))
					.containsExactly("QUIET_GOOD", "SHORT_WAIT_BAD");
		}

		@Test
		@DisplayName("등록_로그인을본문검증보다먼저확인한다")
		void create_authenticatesBeforeValidatingBody() throws Exception {
			createUsers(1);
			String token = auth.login(USER_PREFIX + "0@example.com", PASSWORD, "127.0.0.1").accessToken();
			String path = "/api/v1/places/1/reviews";

			assertThat(send("POST", path, null, "{}").statusCode()).isEqualTo(401);
			assertThat(send("POST", path, token, "{}").statusCode()).isEqualTo(400);
			assertThat(send("POST", path, token, json("2026-10-22", "내일")).statusCode()).isEqualTo(400);
			assertThat(count("reviews")).isZero();
		}

		@Test
		@DisplayName("등록_탈퇴한뒤남은토큰으로는_401이다")
		void create_afterWithdrawalWithOldToken_unauthorized() throws Exception {
			String user = createUsers(1).getFirst();
			String token = auth.login(USER_PREFIX + "0@example.com", PASSWORD, "127.0.0.1").accessToken();

			withdrawAccount(user);

			assertThat(send("POST", "/api/v1/places/1/reviews", token, json("2026-10-21", "탈퇴 뒤"))
					.statusCode()).isEqualTo(401);
		}
	}

}
