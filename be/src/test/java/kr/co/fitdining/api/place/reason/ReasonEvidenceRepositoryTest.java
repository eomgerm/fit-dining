package kr.co.fitdining.api.place.reason;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import kr.co.fitdining.api.place.reason.ReasonEvidenceRepository.ReviewRow;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 근거 SQL을 실제 PostgreSQL(pgvector)과 시드된 특징 코드표, 이유 태그로 확인한다. */
class ReasonEvidenceRepositoryTest extends PostgresTestSupport {

	private static JdbcTemplate jdbc;

	private ReasonEvidenceRepository repository;
	private final List<Long> placeIds = new ArrayList<>();
	private final List<String> userIds = new ArrayList<>();

	@BeforeAll
	static void migrateOnce() throws Exception {
		migrate();
		jdbc = new JdbcTemplate(appSource());
	}

	@BeforeEach
	void setUp() {
		repository = new ReasonEvidenceRepository(JdbcClient.create(appSource()));
	}

	@AfterEach
	void cleanUp() {
		// 컨테이너를 모든 테스트 클래스가 함께 쓰므로 이 클래스가 넣은 행만 지운다
		placeIds.forEach(id -> {
			jdbc.update("DELETE FROM review_reason_tags WHERE review_id IN (SELECT review_id FROM reviews WHERE place_id = ?)",
					id);
			jdbc.update("DELETE FROM reviews WHERE place_id = ?", id);
			jdbc.update("DELETE FROM places WHERE place_id = ?", id);
		});
		userIds.forEach(id -> jdbc.update("DELETE FROM auth_users WHERE id = ?", id));
	}

	private long place(String category) {
		long id = jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, station, lat, lng, facilities)
				VALUES (?, '근거 시험', ?, 'YEOKSAM', 37.5004, 127.0365, '{}')
				RETURNING place_id""", Long.class, UUID.randomUUID().toString(), category);
		placeIds.add(id);
		return id;
	}

	/** 페르소나 벡터를 특징 코드 {@code like}의 문구 벡터와 똑같이 둔다. 그 코드와 가장 가깝다. */
	private void persona(long placeId, String personaId, String name, boolean liked, String like) {
		jdbc.update("""
				INSERT INTO place_personas (place_id, persona_id, name, description, reason, liked, vector)
				SELECT ?, ?, ?, '설명', '이유', ?, vector FROM feature_codes WHERE code = ?""",
				placeId, personaId, name, liked, like);
	}

	private String user(String nickname, boolean withdrawn) {
		String id = "u-" + UUID.randomUUID();
		jdbc.update("""
				INSERT INTO auth_users (id, email, nickname, age_confirmed_at, terms_agreed_at, privacy_agreed_at,
				    terms_version, password_hash, created_at, deleted_at)
				VALUES (?, ?, ?, now(), now(), now(), '2026-10-23', 'not-a-real-hash', now() - interval '1 day',
				    CASE WHEN ? THEN now() END)""", id, id + "@example.com", nickname, withdrawn);
		userIds.add(id);
		return id;
	}

	private void review(long placeId, String userId, LocalDate visit, int minutesAgo, boolean deleted,
			String... tags) {
		long reviewId = jdbc.queryForObject("""
				INSERT INTO reviews (place_id, user_id, visit_date, created_at, deleted_at)
				VALUES (?, ?, ?, now() - make_interval(mins => ?), CASE WHEN ? THEN now() END)
				RETURNING review_id""", Long.class, placeId, userId, visit, minutesAgo, deleted);
		for (String tag : tags) {
			jdbc.update("INSERT INTO review_reason_tags (review_id, code) VALUES (?, ?)", reviewId, tag);
		}
	}

	@Nested
	@DisplayName("장소 페르소나")
	class Personas {

		@Test
		@DisplayName("페르소나_만족한손님중_특징문구벡터와가장가까운것을고른다")
		void persona_closestLiked() {
			long id = place("CAFE");
			persona(id, "p1", "아늑한 손님", true, "COZY");
			persona(id, "p2", "조용한 손님", true, "QUIET");
			persona(id, "p3", "아쉬운 조용함", false, "QUIET");

			assertThat(repository.persona(id, "QUIET")).get().extracting(ReasonEvidenceRepository.Persona::name)
					.isEqualTo("조용한 손님");
		}

		@Test
		@DisplayName("페르소나_가장가까워도특징과무관하면_짝짓지않는다")
		void persona_unrelated_none() {
			long id = place("CAFE");
			// 조용함 문구와 일식 문구의 유사도는 0.14로 최소 유사도보다 낮다
			persona(id, "p1", "일식 손님", true, "FOOD_JAPANESE");

			assertThat(repository.persona(id, "QUIET")).isEmpty();
		}

		@Test
		@DisplayName("페르소나_코드표에없는코드거나만족한손님이없으면_없다")
		void persona_none() {
			long id = place("CAFE");
			persona(id, "p1", "아쉬운 조용함", false, "QUIET");

			assertThat(repository.persona(id, "QUIET")).isEmpty();
			assertThat(repository.persona(id, "PARKING")).isEmpty();
		}
	}

	@Nested
	@DisplayName("앱 리뷰")
	class Reviews {

		@Test
		@DisplayName("리뷰_그특징을좋았다고고른것만_지운리뷰를빼고최근작성순으로개수만큼준다")
		void reviews_goodTagOnly_newestFirst() {
			long id = place("CAFE");
			review(id, user("첫손님", false), LocalDate.of(2026, 10, 1), 30, false, "QUIET_GOOD");
			review(id, user("둘째손님", false), LocalDate.of(2026, 10, 2), 20, false, "QUIET_GOOD", "COZY_GOOD");
			review(id, user("지운손님", false), LocalDate.of(2026, 10, 3), 10, true, "QUIET_GOOD");
			review(id, user("아쉬운손님", false), LocalDate.of(2026, 10, 4), 5, false, "QUIET_BAD");
			review(id, user("다른특징", false), LocalDate.of(2026, 10, 5), 1, false, "COZY_GOOD");
			review(id, user("오래된손님", false), LocalDate.of(2026, 9, 1), 60, false, "QUIET_GOOD");

			assertThat(repository.reviews(id, "QUIET", "CAFE", 2)).containsExactly(
					new ReviewRow("둘째손님", LocalDate.of(2026, 10, 2), "조용해서 좋았어요"),
					new ReviewRow("첫손님", LocalDate.of(2026, 10, 1), "조용해서 좋았어요"));
		}

		@Test
		@DisplayName("리뷰_탈퇴한회원은닉네임을빼고_업종문구가있으면업종문구다")
		void reviews_withdrawnNicknameHidden_categoryLabel() {
			long id = place("BAR");
			review(id, user("떠난손님", true), LocalDate.of(2026, 10, 1), 1, false, "PURPOSE_SOLO_GOOD");

			assertThat(repository.reviews(id, "PURPOSE_SOLO", "BAR", 2))
					.containsExactly(new ReviewRow(null, LocalDate.of(2026, 10, 1), "혼술하기 좋았어요"));
		}
	}

}
