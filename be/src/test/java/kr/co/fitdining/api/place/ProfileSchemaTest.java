package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/** V6의 장소 특징·페르소나·취향 프로필 저장 구조(docs/specs/profile-storage)를 앱 계정으로 확인한다. */
class ProfileSchemaTest extends PostgresTestSupport {

	private static final String VECTOR = "[" + String.join(",", Collections.nCopies(1024, "0.01")) + "]";
	private static final String USER_ID = "profile-schema-test-user";

	private static JdbcTemplate jdbc;

	@BeforeAll
	static void setUp() throws Exception {
		migrate();
		jdbc = new JdbcTemplate(appSource());
	}

	private final List<Long> placeIds = new ArrayList<>();

	@AfterEach
	void cleanUp() {
		// 컨테이너를 모든 테스트 클래스가 함께 쓰므로 이 클래스가 넣은 행만 지운다
		placeIds.forEach(id -> jdbc.update("DELETE FROM places WHERE place_id = ?", id));
		jdbc.update("DELETE FROM user_preferences WHERE user_id = ?", USER_ID);
		jdbc.update("DELETE FROM auth_users WHERE id = ?", USER_ID);
	}

	private long insertPlace(String naverPlaceId, String foodType) {
		long id = jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, food_type, station, lat, lng)
				VALUES (?, '테스트 식당', 'RESTAURANT', ?, 'GANGNAM', 37.4979, 127.0276)
				RETURNING place_id""", Long.class, naverPlaceId, foodType);
		placeIds.add(id);
		return id;
	}

	private void insertProfile(long placeId) {
		jdbc.update("""
				INSERT INTO place_profiles (place_id, summary_text, summary_vector, features, analyzed_review_count)
				VALUES (?, '테스트 식당. 식당, 한식.', ?::vector,
				        '[{"code": "PURPOSE_GROUP", "layer": "purpose", "like_count": 7, "dislike_count": 0, "is_label": true}]', 100)""",
				placeId, VECTOR);
	}

	private void insertPersona(long placeId) {
		jdbc.update("""
				INSERT INTO place_personas (place_id, persona_id, name, description, reason, liked, vector)
				VALUES (?, 'p1', '퇴근 후 팀 회식', '설명', '이유', true, ?::vector)""", placeId, VECTOR);
	}

	@Test
	@DisplayName("장소와프로필과페르소나_정상값은_저장되고근거앱리뷰는빈배열이다")
	void insert_validPlaceProfileAndPersona_saved() {
		long placeId = insertPlace("1001", "FOOD_KOREAN");
		insertProfile(placeId);
		insertPersona(placeId);

		assertThat(jdbc.queryForObject("SELECT cardinality(review_ids) FROM place_personas WHERE place_id = ?",
				Integer.class, placeId)).isZero();
	}

	@Test
	@DisplayName("장소_음식종류코드가아니면_거부된다")
	void insert_unknownFoodType_rejected() {
		assertThatThrownBy(() -> insertPlace("1002", "FOOD_SPICY")).isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("ck_places_food_type");
	}

	@Test
	@DisplayName("장소_네이버장소ID가겹치면_거부된다")
	void insert_duplicateNaverPlaceId_rejected() {
		insertPlace("1003", null);

		assertThatThrownBy(() -> insertPlace("1003", null)).isInstanceOf(DataIntegrityViolationException.class)
				.hasMessageContaining("uk_places_naver_place_id");
	}

	@Test
	@DisplayName("이유태그_코드표에없는특징코드면_거부된다")
	void insertReasonTag_unknownFeatureCode_rejected() {
		assertThatThrownBy(() -> jdbc.update("""
				INSERT INTO reason_tags (code, feature_code, sentiment, label, display_group, sort_order)
				VALUES ('PROFILE_SCHEMA_TEST_GOOD', 'NOT_A_FEATURE', 'GOOD', '시험', '시험', 999)"""))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("fk_reason_tags_feature_code");
	}

	@Test
	@DisplayName("특징코드_AI코드표23개가_시드되어있다")
	void featureCodes_seededFromAiCodeTable() {
		assertThat(jdbc.queryForObject("SELECT count(*) FROM feature_codes", Integer.class)).isEqualTo(23);
		// 문구 벡터는 L2 정규화해 넣었다
		assertThat(jdbc.queryForObject("SELECT count(*) FROM feature_codes WHERE abs(vector_norm(vector) - 1) > 0.001",
				Integer.class)).isZero();
	}

	@Test
	@DisplayName("장소삭제_프로필과페르소나도함께지워진다")
	void delete_place_cascadesProfileAndPersonas() {
		long placeId = insertPlace("1004", null);
		insertProfile(placeId);
		insertPersona(placeId);

		jdbc.update("DELETE FROM places WHERE place_id = ?", placeId);

		assertThat(jdbc.queryForObject("SELECT count(*) FROM place_profiles WHERE place_id = ?", Integer.class,
				placeId)).isZero();
		assertThat(jdbc.queryForObject("SELECT count(*) FROM place_personas WHERE place_id = ?", Integer.class,
				placeId)).isZero();
	}

	@Test
	@DisplayName("온보딩저장_features를주지않으면_빈배열이다")
	void insertPreferences_withoutFeatures_emptyArray() {
		jdbc.update("""
				INSERT INTO auth_users (id, nickname, age_confirmed_at, terms_agreed_at, privacy_agreed_at, terms_version, created_at)
				VALUES (?, '스키마시험', now(), now(), now(), 'v1', now())""", USER_ID);
		jdbc.update("INSERT INTO user_preferences (user_id, created_at, updated_at) VALUES (?, now(), now())", USER_ID);

		assertThat(jdbc.queryForObject("SELECT features::text FROM user_preferences WHERE user_id = ?", String.class,
				USER_ID)).isEqualTo("[]");
	}
}
