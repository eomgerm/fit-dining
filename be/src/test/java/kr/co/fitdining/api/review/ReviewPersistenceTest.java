package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import jakarta.persistence.EntityManagerFactory;
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
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import javax.sql.DataSource;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.review.dto.PhotoView;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewDetailResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.dto.ReviewReportRequest;
import kr.co.fitdining.api.review.dto.ReviewUpdateRequest;
import kr.co.fitdining.api.review.dto.TagView;
import kr.co.fitdining.api.review.exception.DuplicateReportException;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;
import kr.co.fitdining.api.review.exception.InvalidVisitDateException;
import kr.co.fitdining.api.review.exception.OwnReviewReportException;
import kr.co.fitdining.api.review.exception.ReviewForbiddenException;
import kr.co.fitdining.api.review.exception.ReviewNotFoundException;
import kr.co.fitdining.api.review.photo.FakePhotoStorage;
import kr.co.fitdining.api.review.photo.InvalidPhotoException;
import kr.co.fitdining.api.review.photo.PhotoStorageUnavailableException;
import kr.co.fitdining.api.review.report.ReportReason;
import kr.co.fitdining.api.review.store.ReviewRepository;
import kr.co.fitdining.api.review.tag.ReasonTag;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.UserService;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
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
	/** 로그인 시도 제한(주소마다 15분에 20번)은 다른 통합 테스트와 함께 세므로 이 테스트만의 주소로 로그인하고 지운다. */
	private static final String CLIENT_ADDRESS = USER_PREFIX + "client";
	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	@DynamicPropertySource
	static void placeMock(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "true");
		registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock reviewTestClock() {
			return new MutableClock();
		}

		@Bean
		@Primary
		FakePhotoStorage reviewTestPhotoStorage() {
			return new FakePhotoStorage();
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
	FakePhotoStorage photoStorage;

	@Autowired
	UserService userService;

	@Autowired
	EntityManagerFactory entityManagerFactory;

	@Autowired
	PlatformTransactionManager transactionManager;

	@Value("${local.server.port}")
	int port;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		clock.instant = NOON;
		photoStorage.reset();
	}

	@AfterEach
	void cleanUp() {
		JdbcTemplate app = new JdbcTemplate(appSource());
		app.update("delete from review_reports");
		app.update("delete from review_photos");
		app.update("delete from review_reason_tags");
		app.update("delete from reviews");
		app.update("delete from auth_refresh_tokens where user_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_users where id like ?", USER_PREFIX + "%");
		app.update("delete from auth_login_attempts where address = ?", CLIENT_ADDRESS);
	}

	/** {@link #createUsers}가 만든 n번째 사용자로 로그인한 AT */
	private String login(int user) {
		return auth.login(USER_PREFIX + user + "@example.com", PASSWORD, CLIENT_ADDRESS).accessToken();
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
		return new ReviewCreateRequest(visitedAt, tagCodes, false, description, null, null);
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
			ReviewItem item = service.list(1, null, null).items().getFirst();
			assertThat(item.createdAt().toString()).isEqualTo("2026-10-22T00:30:00.123456+09:00");
		}

		@Test
		@DisplayName("등록_공백뿐인본문이면_본문없이저장한다")
		void create_blankDescription_storedWithoutDescription() {
			String user = createUsers(1).getFirst();

			service.create(1, user, body(" \n "));

			assertThat(service.list(1, null, null).items().getFirst().description()).isNull();
		}

		@Test
		@DisplayName("등록_같은사용자장소날짜로두번_두번째는중복예외이고한건만남는다")
		void create_sameUserPlaceDate_secondIsDuplicate() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body("첫 번째"));

			assertThatThrownBy(() -> service.create(1, user, body("두 번째")))
					.isInstanceOf(DuplicateReviewException.class);
			assertThat(service.list(1, null, null).totalCount()).isEqualTo(1);
		}

		@Test
		@DisplayName("등록_다른장소나다른날이면_모두저장한다")
		void create_otherPlaceOrDate_saved() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body(null));
			service.create(2, user, body(null));
			clock.instant = NOON.plusSeconds(24 * 60 * 60);

			assertThatCode(() -> service.create(1, user, body(null))).doesNotThrowAnyException();
			assertThat(service.list(1, null, null).totalCount()).isEqualTo(2);
		}

		@Test
		@DisplayName("등록_같은날리뷰를삭제했으면_다시쓸수있다")
		void create_afterSoftDelete_allowedAgain() {
			String user = createUsers(1).getFirst();
			service.create(1, user, body("지울 리뷰"));
			jdbc.update("update reviews set deleted_at = now()");

			assertThatCode(() -> service.create(1, user, body("다시 쓴 리뷰"))).doesNotThrowAnyException();
			assertThat(service.list(1, null, null).items()).extracting(ReviewItem::description).containsExactly("다시 쓴 리뷰");
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
					List.of("QUIET_GOOD", "SHORT_WAIT_BAD"), true, null, 1_000_000, null)).reviewId();

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
				assertThatThrownBy(() -> service.create(5, user, request(TODAY, tagCodes, null)))
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

			ReviewListResponse first = service.list(1, null, null);
			ReviewListResponse second = service.list(1, first.nextCursor(), null);
			ReviewListResponse third = service.list(1, second.nextCursor(), null);

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

			assertThat(service.list(1, null, null).items()).extracting(ReviewItem::description).containsExactly("나중", "먼저");
		}

		@Test
		@DisplayName("목록_정확히20건이면_다음커서가없다")
		void list_exactly20_noNextCursor() {
			for (String user : createUsers(20)) {
				service.create(1, user, body(null));
			}

			ReviewListResponse page = service.list(1, null, null);

			assertThat(page.items()).hasSize(20);
			assertThat(page.nextCursor()).isNull();
		}

		@Test
		@DisplayName("목록_리뷰가없으면_빈목록과0이다")
		void list_noReviews_emptyAndZero() {
			ReviewListResponse page = service.list(1, null, null);

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

			ReviewListResponse page = service.list(1, null, null);

			assertThat(page.totalCount()).isEqualTo(1);
			assertThat(page.items()).extracting(ReviewItem::description).containsExactly(authors.get(1));
		}

		@Test
		@DisplayName("목록_다른장소의리뷰는_보이지않는다")
		void list_otherPlace_notShown() {
			String user = createUsers(1).getFirst();
			service.create(2, user, body(null));

			assertThat(service.list(1, null, null).totalCount()).isZero();
		}

		@Test
		@DisplayName("목록_항목에방문일닉네임재방문의사태그가있고_내리뷰만mine이다")
		void list_items_carryVisitFieldsAndMine() {
			List<String> authors = createUsers(2);
			LocalDate yesterday = LocalDate.ofInstant(clock.instant, SEOUL).minusDays(1);
			service.create(3, authors.get(0), new ReviewCreateRequest(yesterday, List.of("SHORT_WAIT_BAD", "QUIET_GOOD"),
					true, "내 리뷰", null, null));
			clock.instant = NOON.plusSeconds(60);
			service.create(3, authors.get(1), body("남의 리뷰"));

			List<ReviewItem> signedIn = service.list(3, null, authors.get(0)).items();

			assertThat(signedIn).extracting(ReviewItem::description, ReviewItem::mine)
					.containsExactly(tuple("남의 리뷰", false), tuple("내 리뷰", true));
			ReviewItem own = signedIn.get(1);
			assertThat(own.visitedAt()).isEqualTo(yesterday);
			assertThat(own.nickname()).isEqualTo("리뷰테스트0");
			assertThat(own.revisitIntent()).isTrue();
			assertThat(own.tags()).containsExactly(
					new TagView("QUIET_GOOD", "조용해서 좋았어요", ReasonTag.Sentiment.GOOD),
					new TagView("SHORT_WAIT_BAD", "대기가 길었어요", ReasonTag.Sentiment.BAD));
			assertThat(service.list(3, null, null).items()).extracting(ReviewItem::mine).containsOnly(false);
		}

		/** 태그가 확정되면 시드 순서가 바뀔 수 있어, 아쉬웠어요의 순서를 앞으로 당겨도 좋았어요가 먼저인지 본다. */
		@Test
		@DisplayName("목록_태그는_시드순서와상관없이좋았어요가먼저다")
		void list_tags_goodFirstRegardlessOfSeedOrder() {
			String user = createUsers(1).getFirst();
			service.create(3, user, request(LocalDate.ofInstant(clock.instant, SEOUL),
					List.of("QUIET_GOOD", "SHORT_WAIT_BAD"), null));
			Integer badOrder = jdbc.queryForObject("select sort_order from reason_tags where code = 'SHORT_WAIT_BAD'",
					Integer.class);
			jdbc.update("update reason_tags set sort_order = 0 where code = 'SHORT_WAIT_BAD'");
			try {
				assertThat(service.list(3, null, null).items().getFirst().tags()).extracting(TagView::code)
						.containsExactly("QUIET_GOOD", "SHORT_WAIT_BAD");
			} finally {
				jdbc.update("update reason_tags set sort_order = ? where code = 'SHORT_WAIT_BAD'", badOrder);
			}
		}

		@Test
		@DisplayName("목록_태그문구는_장소업종의문구다")
		void list_tagLabel_followsPlaceCategory() {
			String user = createUsers(1).getFirst();
			ReviewCreateRequest solo = request(LocalDate.ofInstant(clock.instant, SEOUL), List.of("PURPOSE_SOLO_GOOD"), null);
			service.create(5, user, solo);
			service.create(2, user, solo);

			assertThat(service.list(5, null, null).items().getFirst().tags()).extracting(TagView::label)
					.containsExactly("혼밥하기 좋았어요");
			assertThat(service.list(2, null, null).items().getFirst().tags()).extracting(TagView::label)
					.containsExactly("혼술하기 좋았어요");
		}

		@Test
		@DisplayName("목록_없는장소면_예외다")
		void list_unknownPlace_throws() {
			assertThatThrownBy(() -> service.list(999, null, null)).isInstanceOf(PlaceNotFoundException.class);
		}

		/** 작성자, 태그, 사진을 리뷰마다 읽으면 페이지 크기만큼 쿼리가 는다. Hibernate가 보낸 SQL 수로 확인한다(D-42, D-45). */
		@Test
		@DisplayName("목록_작성자태그사진을페이지단위로읽어_첫페이지는쿼리5번다음페이지는4번이다")
		void list_batchesAuthorsTagsAndPhotos_fixedQueryCount() {
			LocalDate today = LocalDate.ofInstant(clock.instant, SEOUL);
			for (String user : createUsers(25)) {
				service.create(1, user, request(today, List.of("QUIET_GOOD", "SHORT_WAIT_BAD"), null));
			}
			Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();

			statistics.clear();
			ReviewListResponse first = service.list(1, null, null);
			long firstPage = statistics.getPrepareStatementCount();
			statistics.clear();
			ReviewListResponse second = service.list(1, first.nextCursor(), null);
			long secondPage = statistics.getPrepareStatementCount();

			assertThat(first.items()).hasSize(20).allSatisfy(item -> {
				assertThat(item.nickname()).isNotNull();
				assertThat(item.tags()).hasSize(2);
			});
			assertThat(second.items()).hasSize(5);
			assertThat(firstPage).isEqualTo(5);
			assertThat(secondPage).isEqualTo(4);
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
			assertThat(form.place().lat()).isNotNull();
			assertThat(form.place().lng()).isNotNull();
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

	/** 본인 리뷰만 다루는 세 동작. 권한·없는 리뷰·탈퇴 시험을 동작마다 한 번씩 돌린다. */
	enum Operation {
		DETAIL {
			@Override
			void run(ReviewService service, long reviewId, String userId) {
				service.detail(reviewId, userId);
			}
		},
		UPDATE {
			@Override
			void run(ReviewService service, long reviewId, String userId) {
				service.update(reviewId, userId, new ReviewUpdateRequest("바꾼 본문", null));
			}
		},
		DELETE {
			@Override
			void run(ReviewService service, long reviewId, String userId) {
				service.delete(reviewId, userId);
			}
		};

		abstract void run(ReviewService service, long reviewId, String userId);
	}

	@Nested
	@DisplayName("수정과 삭제")
	class EditAndDelete {

		private static final long WAIT_SECONDS = 5;

		private long write(String user, String description) {
			return service.create(1, user, body(description)).reviewId();
		}

		private Map<String, Object> row(long reviewId) {
			return jdbc.queryForMap("select description, visit_date, revisit_intent, spent_per_person, created_at,"
					+ " updated_at, deleted_at from reviews where review_id = ?", reviewId);
		}

		/** 다른 트랜잭션이 행 잠금을 기다리기 시작할 때까지 기다린다. 시간에 기대지 않고 잠금 대기를 직접 확인한다. */
		private void awaitLockWaiter() throws InterruptedException {
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(WAIT_SECONDS);
			while (jdbc.queryForObject("select count(*) from pg_locks where not granted", Integer.class) == 0) {
				assertThat(System.nanoTime()).as("행 잠금을 기다리는 트랜잭션").isLessThan(deadline);
				Thread.sleep(20);
			}
		}

		/** 작성자의 삭제가 행을 잠근 채 커밋을 기다리게 한다. {@code commit}을 풀어야 커밋한다. */
		private Future<?> deleteHoldingLock(ExecutorService pool, long reviewId, String user, CountDownLatch locked,
				CountDownLatch commit) {
			TransactionTemplate tx = new TransactionTemplate(transactionManager);
			return pool.submit(() -> tx.executeWithoutResult(status -> {
				try {
					service.delete(reviewId, user);
					reviews.flush();
				} finally {
					locked.countDown();
				}
				try {
					commit.await(WAIT_SECONDS, TimeUnit.SECONDS);
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
				}
			}));
		}

		@Test
		@DisplayName("조회_내리뷰면_장소와본문과제한값을돌려준다")
		void detail_own_returnsPlaceDescriptionAndLimits() {
			String user = createUsers(1).getFirst();
			long id = write(user, "고칠 본문");

			ReviewDetailResponse detail = service.detail(id, user);

			assertThat(detail.reviewId()).isEqualTo(id);
			assertThat(detail.placeId()).isEqualTo(1L);
			assertThat(detail.description()).isEqualTo("고칠 본문");
			assertThat(detail.limits().descriptionMax()).isEqualTo(500);
			assertThat(detail.limits().photoMax()).isEqualTo(5);
		}

		@Test
		@DisplayName("수정_본문만바뀌고_다른필드와목록순서는그대로이며수정시각이바뀐다")
		void update_changesDescriptionOnly_keepsOrder() {
			List<String> authors = createUsers(2);
			long older = write(authors.get(0), "먼저 쓴 리뷰");
			clock.instant = NOON.plusSeconds(60);
			write(authors.get(1), "나중에 쓴 리뷰");
			Map<String, Object> before = row(older);
			clock.instant = NOON.plusSeconds(120);

			service.update(older, authors.get(0), new ReviewUpdateRequest("고친 리뷰", null));

			Map<String, Object> after = row(older);
			assertThat(after.get("description")).isEqualTo("고친 리뷰");
			assertThat(((java.sql.Timestamp) after.get("updated_at")).toInstant())
					.isEqualTo(Instant.parse("2026-10-21T03:02:00.123456Z"));
			for (String column : List.of("visit_date", "revisit_intent", "spent_per_person", "created_at")) {
				assertThat(after.get(column)).isEqualTo(before.get(column));
			}
			assertThat(jdbc.queryForList("select code from review_reason_tags where review_id = ?", String.class, older))
					.containsExactly("QUIET_GOOD");
			assertThat(service.list(1, null, null).items()).extracting(ReviewItem::description)
					.containsExactly("나중에 쓴 리뷰", "고친 리뷰");
		}

		@Test
		@DisplayName("수정_공백뿐이면_본문없이저장한다")
		void update_blankDescription_storedWithoutDescription() {
			String user = createUsers(1).getFirst();
			long id = write(user, "처음 본문");

			service.update(id, user, new ReviewUpdateRequest(" \n ", null));

			assertThat(row(id).get("description")).isNull();
		}

		@Test
		@DisplayName("수정_같은본문이면_수정시각을바꾸지않는다")
		void update_sameDescription_keepsUpdatedAt() {
			String user = createUsers(1).getFirst();
			long id = write(user, "그대로인 본문");
			Object before = row(id).get("updated_at");
			clock.instant = NOON.plusSeconds(60);

			service.update(id, user, new ReviewUpdateRequest("그대로인 본문", null));

			assertThat(row(id).get("updated_at")).isEqualTo(before);
		}

		@Test
		@DisplayName("삭제_내리뷰면_목록과리뷰수에서빠진다")
		void delete_own_removedFromListAndCount() {
			String user = createUsers(1).getFirst();
			long id = write(user, "지울 리뷰");
			clock.instant = NOON.plusSeconds(60);

			service.delete(id, user);

			Map<String, Object> deleted = row(id);
			assertThat(deleted.get("deleted_at")).isEqualTo(deleted.get("updated_at")).isNotNull();
			assertThat(service.list(1, null, null).totalCount()).isZero();
		}

		@Test
		@DisplayName("삭제_지운뒤에는_같은방문일로다시쓸수있다")
		void delete_own_sameVisitDateWritableAgain() {
			String user = createUsers(1).getFirst();
			long id = write(user, "지울 리뷰");

			service.delete(id, user);

			assertThat(service.reviewForm(1, user).reviewedDates()).isEmpty();
			assertThatCode(() -> write(user, "다시 쓴 리뷰")).doesNotThrowAnyException();
			assertThat(service.list(1, null, null).items()).extracting(ReviewItem::description)
					.containsExactly("다시 쓴 리뷰");
		}

		@ParameterizedTest
		@EnumSource(Operation.class)
		@DisplayName("조회수정삭제_남의리뷰면_403이고바뀌지않는다")
		void operation_othersReview_forbiddenAndUnchanged(Operation operation) {
			List<String> authors = createUsers(2);
			long id = write(authors.get(0), "남의 리뷰");
			Map<String, Object> before = row(id);

			assertThatThrownBy(() -> operation.run(service, id, authors.get(1)))
					.isInstanceOf(ReviewForbiddenException.class);
			assertThat(row(id)).isEqualTo(before);
		}

		@ParameterizedTest
		@EnumSource(Operation.class)
		@DisplayName("조회수정삭제_삭제한리뷰면_404다")
		void operation_deletedReview_notFound(Operation operation) {
			String user = createUsers(1).getFirst();
			long id = write(user, "지운 리뷰");
			service.delete(id, user);

			assertThatThrownBy(() -> operation.run(service, id, user)).isInstanceOf(ReviewNotFoundException.class);
		}

		@ParameterizedTest
		@EnumSource(Operation.class)
		@DisplayName("조회수정삭제_없는리뷰면_404다")
		void operation_missingReview_notFound(Operation operation) {
			String user = createUsers(1).getFirst();
			long id = write(user, "있는 리뷰");

			assertThatThrownBy(() -> operation.run(service, id + 1000, user))
					.isInstanceOf(ReviewNotFoundException.class);
		}

		@ParameterizedTest
		@EnumSource(Operation.class)
		@DisplayName("조회수정삭제_탈퇴한사용자면_401이고바뀌지않는다")
		void operation_withdrawnUser_unauthorized(Operation operation) {
			String user = createUsers(1).getFirst();
			long id = write(user, "탈퇴 전 리뷰");
			withdrawAccount(user);
			Map<String, Object> before = row(id);

			assertThatThrownBy(() -> operation.run(service, id, user)).isInstanceOf(AuthFailure.class);
			assertThat(row(id)).isEqualTo(before);
		}

		/** 잠그지 않으면 삭제 전에 읽은 수정이 모든 컬럼을 다시 써 {@code deleted_at}을 null로 되돌린다(D-44). */
		@Test
		@DisplayName("수정_삭제가먼저잠갔으면_기다렸다가404이고리뷰는삭제된채다")
		void update_whileDeleting_waitsAndNotFound() throws Exception {
			String user = createUsers(1).getFirst();
			long id = write(user, "지울 리뷰");
			CountDownLatch locked = new CountDownLatch(1);
			CountDownLatch commit = new CountDownLatch(1);
			ExecutorService pool = Executors.newFixedThreadPool(2);
			try {
				Future<?> deleting = deleteHoldingLock(pool, id, user, locked, commit);
				assertThat(locked.await(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();
				Future<?> updating = pool.submit(() -> service.update(id, user, new ReviewUpdateRequest("늦은 수정", null)));
				awaitLockWaiter();

				commit.countDown();
				deleting.get(WAIT_SECONDS, TimeUnit.SECONDS);
				assertThatThrownBy(() -> updating.get(WAIT_SECONDS, TimeUnit.SECONDS))
						.hasCauseInstanceOf(ReviewNotFoundException.class);
			} finally {
				commit.countDown();
				pool.shutdownNow();
			}
			Map<String, Object> after = row(id);
			assertThat(after.get("deleted_at")).isNotNull();
			assertThat(after.get("description")).isEqualTo("지울 리뷰");
		}

		/** 잠금은 본인 리뷰에만 건다. 남의 요청은 작성자가 잠근 행을 기다리지 않고 바로 403이다(D-44). */
		@ParameterizedTest
		@EnumSource(value = Operation.class, names = {"UPDATE", "DELETE"})
		@DisplayName("수정삭제_작성자가잠근동안남이보내면_기다리지않고403이다")
		void operation_othersWhileOwnerLocks_forbiddenWithoutWaiting(Operation operation) throws Exception {
			List<String> authors = createUsers(2);
			long id = write(authors.get(0), "작성자가 지우는 리뷰");
			CountDownLatch locked = new CountDownLatch(1);
			CountDownLatch commit = new CountDownLatch(1);
			ExecutorService pool = Executors.newFixedThreadPool(2);
			try {
				deleteHoldingLock(pool, id, authors.get(0), locked, commit);
				assertThat(locked.await(WAIT_SECONDS, TimeUnit.SECONDS)).isTrue();

				Future<?> others = pool.submit(() -> operation.run(service, id, authors.get(1)));

				assertThatThrownBy(() -> others.get(WAIT_SECONDS, TimeUnit.SECONDS))
						.hasCauseInstanceOf(ReviewForbiddenException.class);
			} finally {
				commit.countDown();
				pool.shutdownNow();
			}
		}
	}

	@Nested
	@DisplayName("사진")
	class Photos {

		private static ReviewCreateRequest withPhotos(LocalDate visitedAt, List<UUID> photos) {
			return new ReviewCreateRequest(visitedAt, List.of("QUIET_GOOD"), false, null, null, photos);
		}

		private LocalDate today() {
			return LocalDate.ofInstant(clock.instant, SEOUL);
		}

		private long write(String user, List<UUID> uploads) {
			return service.create(1, user, withPhotos(today(), uploads)).reviewId();
		}

		/** 리뷰에 붙은 확정본 사진 id. 화면 순서대로다. */
		private List<UUID> photoIds(long reviewId) {
			return jdbc.queryForList("select photo_id from review_photos where review_id = ? order by sort_order",
					UUID.class, reviewId);
		}

		/** 리뷰 사진을 확정본 1,600px 크기로 본다. 올릴 때 사진마다 크기를 달리해 어느 사진인지 가린다. */
		private List<Integer> sizes(long reviewId) {
			return photoIds(reviewId).stream().map(photoStorage::confirmedSize).toList();
		}

		private static ReviewUpdateRequest photosOnly(List<UUID> photos) {
			return new ReviewUpdateRequest(null, photos);
		}

		@Test
		@DisplayName("등록_올린사진이면_새사진id로순서대로저장하고확정본을만든뒤업로드원본을지운다")
		void create_uploadedPhotos_savesNewIdsInOrder() {
			String user = createUsers(1).getFirst();
			UUID first = photoStorage.upload(901, 91);
			UUID second = photoStorage.upload(902, 92);

			long id = write(user, List.of(second, first));

			assertThat(sizes(id)).containsExactly(902, 901);
			assertThat(photoIds(id)).doesNotContain(first, second);
			assertThat(photoStorage.hasPending(first)).isFalse();
			assertThat(photoStorage.hasPending(second)).isFalse();
		}

		@Test
		@DisplayName("목록_사진은_순서대로같은출처읽기주소다")
		void list_photos_inOrderWithReadPaths() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload(902, 92), photoStorage.upload(901, 91)));
			List<UUID> saved = photoIds(id);

			ReviewItem item = service.list(1, null, null).items().getFirst();

			assertThat(item.photos()).extracting(PhotoView::photoId).containsExactlyElementsOf(saved);
			assertThat(item.photos().getFirst().url()).isEqualTo("/photos/dev/confirmed/" + saved.getFirst() + ".jpg");
			assertThat(item.photos().getFirst().thumbUrl())
					.isEqualTo("/photos/dev/confirmed/" + saved.getFirst() + ".thumb.jpg");
		}

		@Test
		@DisplayName("목록_사진없는리뷰는_빈목록이다")
		void list_noPhotos_emptyList() {
			write(createUsers(1).getFirst(), List.of());

			assertThat(service.list(1, null, null).items().getFirst().photos()).isEmpty();
		}

		@Test
		@DisplayName("등록_올리지않은사진이섞이면_400이고리뷰도확정본도남지않는다")
		void create_missingPhoto_savesNothing() {
			String user = createUsers(1).getFirst();
			UUID uploaded = photoStorage.upload();

			assertThatThrownBy(() -> write(user, List.of(uploaded, UUID.randomUUID())))
					.isInstanceOf(InvalidPhotoException.class);
			assertThat(count("reviews")).isZero();
			assertThat(photoStorage.confirmedIds()).isEmpty();
			assertThat(photoStorage.hasPending(uploaded)).isTrue();
		}

		@Test
		@DisplayName("등록_같은사진을두번보내면_400이다")
		void create_samePhotoTwice_invalid() {
			String user = createUsers(1).getFirst();
			UUID photo = photoStorage.upload();

			assertThatThrownBy(() -> write(user, List.of(photo, photo))).isInstanceOf(InvalidPhotoException.class);
			assertThat(count("reviews")).isZero();
		}

		@Test
		@DisplayName("등록_같은날중복으로409면_이번확정본을지우고업로드원본은남겨다시보낼수있다")
		void create_duplicateVisit_removesOwnCopiesKeepsPending() {
			String user = createUsers(1).getFirst();
			write(user, List.of());
			UUID photo = photoStorage.upload();

			assertThatThrownBy(() -> write(user, List.of(photo))).isInstanceOf(DuplicateReviewException.class);
			assertThat(photoStorage.confirmedIds()).isEmpty();
			assertThat(photoStorage.hasPending(photo)).isTrue();
			assertThatCode(() -> service.create(1, user, withPhotos(today().minusDays(1), List.of(photo))))
					.doesNotThrowAnyException();
		}

		/** 첫 등록이 저장된 뒤 업로드 원본이 남은 채(지우기 실패, 커밋 직후) 같은 사진으로 다시 등록한 경우(코드 리뷰 2026-10-29) */
		@Test
		@DisplayName("등록_저장된리뷰의업로드로다시등록해409가나도_먼저저장된리뷰의사진은남는다")
		void create_retryWithSavedUpload_keepsSavedPhotos() {
			String user = createUsers(1).getFirst();
			UUID upload = photoStorage.upload(901, 91);
			long first = write(user, List.of(upload));
			photoStorage.put("pending/" + upload + ".jpg", FakePhotoStorage.jpeg(901));
			photoStorage.put("pending/" + upload + ".thumb.jpg", FakePhotoStorage.jpeg(91));

			assertThatThrownBy(() -> write(user, List.of(upload))).isInstanceOf(DuplicateReviewException.class);
			assertThat(photoStorage.hasConfirmed(photoIds(first).getFirst())).isTrue();
			assertThat(photoStorage.confirmedIds()).containsExactlyElementsOf(photoIds(first));
		}

		@Test
		@DisplayName("등록_남의업로드원본이남아있어도_따로복사해남의확정본을건드리지않는다")
		void create_othersLeftoverUpload_separateCopy() {
			List<String> users = createUsers(2);
			UUID upload = photoStorage.upload();
			long first = write(users.get(0), List.of(upload));
			photoStorage.put("pending/" + upload + ".jpg", FakePhotoStorage.jpeg(1000));
			photoStorage.put("pending/" + upload + ".thumb.jpg", FakePhotoStorage.jpeg(100));

			long second = write(users.get(1), List.of(upload));
			service.delete(second, users.get(1));

			assertThat(photoIds(second)).doesNotContainAnyElementsOf(photoIds(first));
			assertThat(photoStorage.hasConfirmed(photoIds(first).getFirst())).isTrue();
		}

		@Test
		@DisplayName("등록_저장소에접속하지못하면_503이고저장하지않는다")
		void create_storageDown_unavailable() {
			String user = createUsers(1).getFirst();
			UUID photo = photoStorage.upload();
			photoStorage.down(true);

			assertThatThrownBy(() -> write(user, List.of(photo)))
					.isInstanceOf(PhotoStorageUnavailableException.class);
			assertThat(count("reviews")).isZero();
		}

		@Test
		@DisplayName("조회_내리뷰의사진을순서대로돌려준다")
		void detail_photosInOrder() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload(), photoStorage.upload()));

			assertThat(service.detail(id, user).photos()).extracting(PhotoView::photoId)
					.containsExactlyElementsOf(photoIds(id));
		}

		@Test
		@DisplayName("수정_사진을더하고빼고순서를바꾸면_반영하고빠진확정본과새업로드원본을지운다")
		void update_addRemoveReorder_appliesAndCleansUp() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload(901, 91), photoStorage.upload(902, 92)));
			UUID removed = photoIds(id).get(0);
			UUID kept = photoIds(id).get(1);
			UUID upload = photoStorage.upload(903, 93);
			clock.instant = NOON.plusSeconds(60);

			service.update(id, user, photosOnly(List.of(upload, kept)));

			assertThat(sizes(id)).containsExactly(903, 902);
			assertThat(photoIds(id).get(1)).isEqualTo(kept);
			assertThat(photoStorage.hasPending(upload)).isFalse();
			assertThat(photoStorage.hasConfirmed(removed)).isFalse();
			assertThat(((java.sql.Timestamp) jdbc.queryForObject("select updated_at from reviews", Object.class))
					.toInstant()).isEqualTo(Instant.parse("2026-10-21T03:01:00.123456Z"));
		}

		@Test
		@DisplayName("수정_순서만바꿔도_사진유니크제약에걸리지않는다")
		void update_swapOrder_noConstraintViolation() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload(901, 91), photoStorage.upload(902, 92)));
			List<UUID> saved = photoIds(id);

			service.update(id, user, photosOnly(List.of(saved.get(1), saved.get(0))));

			assertThat(sizes(id)).containsExactly(902, 901);
		}

		@Test
		@DisplayName("수정_같은사진목록이면_updated_at을바꾸지않는다")
		void update_samePhotos_keepsUpdatedAt() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload()));
			Object before = jdbc.queryForObject("select updated_at from reviews", Object.class);
			clock.instant = NOON.plusSeconds(60);

			service.update(id, user, photosOnly(photoIds(id)));

			assertThat(jdbc.queryForObject("select updated_at from reviews", Object.class)).isEqualTo(before);
		}

		@Test
		@DisplayName("수정_본문만보내면_사진은그대로다")
		void update_descriptionOnly_keepsPhotos() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload()));
			List<UUID> saved = photoIds(id);

			service.update(id, user, new ReviewUpdateRequest("본문만 고침", null));

			assertThat(photoIds(id)).isEqualTo(saved);
		}

		@Test
		@DisplayName("수정_빈목록이면_사진을모두빼고확정본을지운다")
		void update_emptyList_removesAll() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload()));
			UUID saved = photoIds(id).getFirst();

			service.update(id, user, photosOnly(List.of()));

			assertThat(photoIds(id)).isEmpty();
			assertThat(photoStorage.hasConfirmed(saved)).isFalse();
		}

		@Test
		@DisplayName("수정_쓸수없는새사진이섞이면_400이고사진과확정본이그대로다")
		void update_invalidNewPhoto_keepsPhotos() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload()));
			UUID saved = photoIds(id).getFirst();

			assertThatThrownBy(() -> service.update(id, user, photosOnly(List.of(saved, UUID.randomUUID()))))
					.isInstanceOf(InvalidPhotoException.class);
			assertThat(photoIds(id)).containsExactly(saved);
			assertThat(photoStorage.confirmedIds()).containsExactly(saved);
		}

		@Test
		@DisplayName("수정_남의리뷰사진id를보내면_400이고남의확정본은그대로다")
		void update_othersPhotoId_invalid() {
			List<String> authors = createUsers(2);
			long others = write(authors.get(0), List.of(photoStorage.upload()));
			UUID othersPhoto = photoIds(others).getFirst();
			long mine = write(authors.get(1), List.of());

			assertThatThrownBy(() -> service.update(mine, authors.get(1), photosOnly(List.of(othersPhoto))))
					.isInstanceOf(InvalidPhotoException.class);
			assertThat(photoIds(mine)).isEmpty();
			assertThat(photoStorage.hasConfirmed(othersPhoto)).isTrue();
		}

		@Test
		@DisplayName("삭제_리뷰를지우면_사진확정본을지운다")
		void delete_review_removesConfirmedPhotos() {
			String user = createUsers(1).getFirst();
			long id = write(user, List.of(photoStorage.upload()));
			UUID saved = photoIds(id).getFirst();

			service.delete(id, user);

			assertThat(photoStorage.hasConfirmed(saved)).isFalse();
		}
	}

	@Nested
	@DisplayName("신고")
	class Report {

		private static final String SELECT = "select reporter_id, reason, detail, created_at from review_reports";

		private long write(String user) {
			return service.create(1, user, body("신고받을 리뷰")).reviewId();
		}

		private static ReviewReportRequest reason(ReportReason reason) {
			return new ReviewReportRequest(reason, null);
		}

		@Test
		@DisplayName("신고_남의리뷰면_사유와설명과신고자와시각을저장한다")
		void report_othersReview_savesReasonDetailReporterAndTime() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));

			service.report(id, users.get(1), new ReviewReportRequest(ReportReason.OTHER, "가게와 상관없는 홍보예요"));

			Map<String, Object> row = jdbc.queryForMap(SELECT);
			assertThat(row).containsEntry("reporter_id", users.get(1)).containsEntry("reason", "OTHER")
					.containsEntry("detail", "가게와 상관없는 홍보예요");
			assertThat(((java.sql.Timestamp) row.get("created_at")).toInstant())
					.isEqualTo(Instant.parse("2026-10-21T03:00:00.123456Z"));
		}

		@Test
		@DisplayName("신고_공백뿐인설명은_설명없음으로저장한다")
		void report_blankDetail_savesWithoutDetail() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));

			service.report(id, users.get(1), new ReviewReportRequest(ReportReason.OTHER, " \n"));

			assertThat(jdbc.queryForMap(SELECT).get("detail")).isNull();
		}

		@Test
		@DisplayName("신고_같은사람이두번하면_409이고한건만남는다")
		void report_twice_conflictsAndKeepsFirst() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));
			service.report(id, users.get(1), reason(ReportReason.AD_SPAM));

			assertThatThrownBy(() -> service.report(id, users.get(1), reason(ReportReason.ABUSE)))
					.isInstanceOf(DuplicateReportException.class);
			assertThat(jdbc.queryForList("select reason from review_reports", String.class)).containsExactly("AD_SPAM");
		}

		@Test
		@DisplayName("신고_다른사람끼리는_같은리뷰를각자신고할수있다")
		void report_differentReporters_savesEach() {
			List<String> users = createUsers(3);
			long id = write(users.get(0));

			service.report(id, users.get(1), reason(ReportReason.AD_SPAM));
			service.report(id, users.get(2), reason(ReportReason.UNRELATED));

			assertThat(count("review_reports")).isEqualTo(2);
		}

		@Test
		@DisplayName("신고_내리뷰면_400이고저장하지않는다")
		void report_ownReview_rejectedWithoutSaving() {
			String user = createUsers(1).getFirst();
			long id = write(user);

			assertThatThrownBy(() -> service.report(id, user, reason(ReportReason.AD_SPAM)))
					.isInstanceOf(OwnReviewReportException.class);
			assertThat(count("review_reports")).isZero();
		}

		@Test
		@DisplayName("신고_지운리뷰면_404다")
		void report_deletedReview_notFound() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));
			service.delete(id, users.get(0));

			assertThatThrownBy(() -> service.report(id, users.get(1), reason(ReportReason.AD_SPAM)))
					.isInstanceOf(ReviewNotFoundException.class);
		}

		@Test
		@DisplayName("신고_없는리뷰면_404다")
		void report_missingReview_notFound() {
			String user = createUsers(1).getFirst();

			assertThatThrownBy(() -> service.report(Long.MAX_VALUE, user, reason(ReportReason.AD_SPAM)))
					.isInstanceOf(ReviewNotFoundException.class);
		}

		@Test
		@DisplayName("신고_탈퇴한사용자면_401이고저장하지않는다")
		void report_withdrawnReporter_unauthorized() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));
			withdrawAccount(users.get(1));

			assertThatThrownBy(() -> service.report(id, users.get(1), reason(ReportReason.AD_SPAM)))
					.isInstanceOf(AuthFailure.class);
			assertThat(count("review_reports")).isZero();
		}

		@Test
		@DisplayName("신고_신고해도_리뷰는목록과리뷰수에그대로있다")
		void report_reported_staysInList() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));

			service.report(id, users.get(1), reason(ReportReason.ABUSE));

			ReviewListResponse page = service.list(1, null, null);
			assertThat(page.totalCount()).isEqualTo(1);
			assertThat(page.items()).extracting(ReviewItem::reviewId).containsExactly(id);
		}

		@Test
		@DisplayName("신고테이블_기타가아닌사유에설명이있으면_제약으로거부한다")
		void reviewReports_detailWithoutOther_rejectedByConstraint() {
			List<String> users = createUsers(2);
			long id = write(users.get(0));

			assertThatThrownBy(() -> jdbc.update("insert into review_reports (review_id, reporter_id, reason, detail)"
					+ " values (?, ?, 'AD_SPAM', '설명')", id, users.get(1)))
					.hasMessageContaining("ck_review_reports_detail");
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
			ReviewListResponse page = service.list(1, null, null);
			assertThat(page.totalCount()).isEqualTo(2);
			assertThat(page.items()).extracting(ReviewItem::description).containsExactly("다른 사람 리뷰", "탈퇴자 리뷰");
			assertThat(page.items()).extracting(ReviewItem::nickname).containsExactly("리뷰테스트1", null);
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
			assertThat(service.list(1, null, null).items()).extracting(ReviewItem::description)
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

		@Test
		@DisplayName("목록태그_리뷰태그기본키로읽는다")
		void reviewTags_usesPrimaryKey() throws Exception {
			String plan = explain(ReviewRepository.REVIEW_TAGS, Map.of("reviewIds", List.of(1L, 2L), "category", "CAFE"));

			assertThat(plan).contains("review_reason_tags_pkey");
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
			String token = login(0);
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
		@DisplayName("목록_로그인하면내리뷰에mine이붙고_틀린토큰은401이다")
		void list_withToken_marksMine() throws Exception {
			createUsers(1);
			String token = login(0);
			String path = "/api/v1/places/1/reviews";
			send("POST", path, token, json("2026-10-18", "내 리뷰"));

			JsonNode signedIn = mapper.readTree(send("GET", path, token, null).body()).get("items").get(0);
			JsonNode anonymous = mapper.readTree(send("GET", path, null, null).body()).get("items").get(0);

			assertThat(signedIn.get("mine").asBoolean()).isTrue();
			assertThat(signedIn.get("nickname").asString()).isEqualTo("리뷰테스트0");
			assertThat(signedIn.get("visitedAt").asString()).isEqualTo("2026-10-18");
			assertThat(anonymous.get("mine").asBoolean()).isFalse();
			assertThat(send("GET", path, "forged", null).statusCode()).isEqualTo(401);
		}

		@Test
		@DisplayName("등록_로그인을본문검증보다먼저확인한다")
		void create_authenticatesBeforeValidatingBody() throws Exception {
			createUsers(1);
			String token = login(0);
			String path = "/api/v1/places/1/reviews";

			assertThat(send("POST", path, null, "{}").statusCode()).isEqualTo(401);
			assertThat(send("POST", path, token, "{}").statusCode()).isEqualTo(400);
			assertThat(send("POST", path, token, json("2026-10-22", "내일")).statusCode()).isEqualTo(400);
			assertThat(count("reviews")).isZero();
		}

		/** 로그인한 두 사용자의 토큰과, 첫 사용자가 HTTP로 등록한 리뷰의 주소 */
		private record Written(String mine, String other, String path) {
		}

		private Written writeOverHttp() throws Exception {
			createUsers(2);
			String mine = login(0);
			String other = login(1);
			long id = mapper.readTree(send("POST", "/api/v1/places/1/reviews", mine, json("2026-10-18", "처음 본문"))
					.body()).get("reviewId").asLong();
			return new Written(mine, other, "/api/v1/reviews/" + id);
		}

		private JsonNode firstPage() throws Exception {
			return mapper.readTree(send("GET", "/api/v1/places/1/reviews", null, null).body());
		}

		@Test
		@DisplayName("수정_내토큰으로_204이고조회와목록에반영된다")
		void update_ownToken_noContentAndReflected() throws Exception {
			Written review = writeOverHttp();

			HttpResponse<String> updated = send("PATCH", review.path(), review.mine(), "{\"description\":\"고친 본문\"}");

			assertThat(updated.statusCode()).isEqualTo(204);
			JsonNode detail = mapper.readTree(send("GET", review.path(), review.mine(), null).body());
			assertThat(detail.get("description").asString()).isEqualTo("고친 본문");
			assertThat(detail.get("placeId").asLong()).isEqualTo(1);
			assertThat(firstPage().get("items").get(0).get("description").asString()).isEqualTo("고친 본문");
		}

		@Test
		@DisplayName("수정_다른필드를보내면_400이고바뀌지않는다")
		void update_otherField_badRequest() throws Exception {
			Written review = writeOverHttp();

			assertThat(send("PATCH", review.path(), review.mine(), "{\"spentPerPerson\":1}").statusCode())
					.isEqualTo(400);
			assertThat(jdbc.queryForObject("select spent_per_person from reviews", Integer.class)).isEqualTo(15000);
		}

		@Test
		@DisplayName("수정_남의토큰이면_403이다")
		void update_othersToken_forbidden() throws Exception {
			Written review = writeOverHttp();

			assertThat(send("PATCH", review.path(), review.other(), "{\"description\":\"남이 고침\"}").statusCode())
					.isEqualTo(403);
		}

		@Test
		@DisplayName("삭제_내토큰으로_204이고목록에서빠지며다시지우면404다")
		void delete_ownToken_noContentThenNotFound() throws Exception {
			Written review = writeOverHttp();

			assertThat(send("DELETE", review.path(), review.mine(), null).statusCode()).isEqualTo(204);
			assertThat(firstPage().get("totalCount").asInt()).isZero();
			assertThat(send("DELETE", review.path(), review.mine(), null).statusCode()).isEqualTo(404);
		}

		@Test
		@DisplayName("삭제_남의토큰이면_403이고목록에남는다")
		void delete_othersToken_forbidden() throws Exception {
			Written review = writeOverHttp();

			assertThat(send("DELETE", review.path(), review.other(), null).statusCode()).isEqualTo(403);
			assertThat(firstPage().get("totalCount").asInt()).isEqualTo(1);
		}

		@Test
		@DisplayName("사진_업로드주소를받아올린뒤등록하면_목록에사진이보인다")
		void photo_uploadThenCreate_shownInList() throws Exception {
			createUsers(1);
			String token = login(0);
			JsonNode uploads = mapper.readTree(send("POST", "/api/v1/review-photos/upload-urls", token,
					"{\"count\":1}").body()).get("uploads");
			String photoId = uploads.get(0).get("photoId").asString();
			photoStorage.put("pending/" + photoId + ".jpg", FakePhotoStorage.jpeg(500));
			photoStorage.put("pending/" + photoId + ".thumb.jpg", FakePhotoStorage.jpeg(50));

			HttpResponse<String> created = send("POST", "/api/v1/places/1/reviews", token,
					"{\"visitedAt\":\"2026-10-18\",\"tagCodes\":[\"QUIET_GOOD\"],\"revisitIntent\":false,"
							+ "\"photos\":[\"" + photoId + "\"]}");

			assertThat(created.statusCode()).isEqualTo(201);
			JsonNode photo = firstPage().get("items").get(0).get("photos").get(0);
			String saved = photo.get("photoId").asString();
			assertThat(saved).isNotEqualTo(photoId);
			assertThat(photo.get("thumbUrl").asString()).isEqualTo("/photos/dev/confirmed/" + saved + ".thumb.jpg");
		}

		@Test
		@DisplayName("사진_쓸수없는사진으로등록하면_400이고type으로구분된다")
		void photo_invalidPhoto_badRequestWithType() throws Exception {
			createUsers(1);
			String token = login(0);

			HttpResponse<String> created = send("POST", "/api/v1/places/1/reviews", token,
					"{\"visitedAt\":\"2026-10-18\",\"tagCodes\":[\"QUIET_GOOD\"],\"revisitIntent\":false,"
							+ "\"photos\":[\"" + UUID.randomUUID() + "\"]}");

			assertThat(created.statusCode()).isEqualTo(400);
			assertThat(mapper.readTree(created.body()).get("type").asString())
					.isEqualTo("urn:fitdining:review:invalid-photo");
		}

		@Test
		@DisplayName("신고_남의토큰으로_201이고같은사람의두번째는409다")
		void report_othersToken_createdThenConflict() throws Exception {
			Written review = writeOverHttp();
			String body = "{\"reason\":\"OTHER\",\"detail\":\"신고 설명\"}";

			HttpResponse<String> first = send("POST", review.path() + "/reports", review.other(), body);
			HttpResponse<String> second = send("POST", review.path() + "/reports", review.other(), body);

			assertThat(first.statusCode()).isEqualTo(201);
			assertThat(first.body()).isEmpty();
			assertThat(second.statusCode()).isEqualTo(409);
			assertThat(count("review_reports")).isEqualTo(1);
		}

		@Test
		@DisplayName("신고_내토큰이면_400이다")
		void report_ownToken_badRequest() throws Exception {
			Written review = writeOverHttp();

			assertThat(send("POST", review.path() + "/reports", review.mine(), "{\"reason\":\"AD_SPAM\"}").statusCode())
					.isEqualTo(400);
		}

		@Test
		@DisplayName("등록_탈퇴한뒤남은토큰으로는_401이다")
		void create_afterWithdrawalWithOldToken_unauthorized() throws Exception {
			String user = createUsers(1).getFirst();
			String token = login(0);

			withdrawAccount(user);

			assertThat(send("POST", "/api/v1/places/1/reviews", token, json("2026-10-21", "탈퇴 뒤"))
					.statusCode()).isEqualTo(401);
		}
	}

}
