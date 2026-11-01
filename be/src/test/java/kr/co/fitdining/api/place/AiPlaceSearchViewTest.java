package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** AI가 읽는 뷰 {@code ai_place_search}의 모양(place-ai-search spec "AI가 읽는 뷰", AC-24)을 앱 계정으로 확인한다. */
class AiPlaceSearchViewTest extends PostgresTestSupport {

	private static final String VECTOR = "[" + String.join(",", Collections.nCopies(1024, "0.01")) + "]";
	private static final String FEATURES = """
			[{"code": "PURPOSE_WORK", "layer": "purpose", "like_count": 20, "dislike_count": 0, "is_label": true}]""";
	private static final JsonMapper JSON = JsonMapper.builder().build();

	private static JdbcTemplate jdbc;

	private final List<Long> placeIds = new ArrayList<>();

	@BeforeAll
	static void setUp() throws Exception {
		migrate();
		jdbc = new JdbcTemplate(appSource());
	}

	@AfterEach
	void cleanUp() {
		// 컨테이너를 모든 테스트 클래스가 함께 쓰므로 이 클래스가 넣은 행만 지운다
		placeIds.forEach(id -> jdbc.update("DELETE FROM places WHERE place_id = ?", id));
	}

	private long insertPlace(String... facilities) {
		long id = jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, station, lat, lng, facilities)
				VALUES (?, '뷰 시험 카페', 'CAFE', 'YEOKSAM', 37.5004, 127.0365, ?::text[])
				RETURNING place_id""", Long.class, UUID.randomUUID().toString(),
				"{" + String.join(",", facilities) + "}");
		placeIds.add(id);
		return id;
	}

	private void insertProfile(long placeId) {
		jdbc.update("""
				INSERT INTO place_profiles (place_id, summary_text, summary_vector, features, analyzed_review_count)
				VALUES (?, '카페, 뷰 시험 카페. 역삼역 근처.', ?::vector, ?::jsonb, 10)""", placeId, VECTOR, FEATURES);
	}

	private JsonNode column(String name, long placeId) {
		return JSON.readTree(jdbc.queryForObject(
				"SELECT " + name + "::text FROM ai_place_search WHERE place_id = ?", String.class, placeId));
	}

	@Test
	@DisplayName("AI뷰_컬럼은_AI가읽는이름과순서다")
	void view_columns_matchAiStore() {
		assertThat(jdbc.queryForList("""
				SELECT column_name FROM information_schema.columns
				WHERE table_name = 'ai_place_search' ORDER BY ordinal_position""", String.class))
				.containsExactly("place_id", "category_group", "station", "lat", "lng", "facilities", "profile",
						"summary_vector");
	}

	@Test
	@DisplayName("AI뷰_프로필이있는장소는_장소값과AI프로필모양으로읽힌다")
	void view_placeWithProfile_readsPlaceValuesAndAiProfile() {
		long id = insertPlace();
		insertProfile(id);

		assertThat(jdbc.queryForMap("""
				SELECT category_group, station, lat, lng, summary_vector::text AS vector
				FROM ai_place_search WHERE place_id = ?""", id))
				.containsEntry("category_group", "CAFE").containsEntry("station", "YEOKSAM")
				.containsEntry("lat", 37.5004).containsEntry("lng", 127.0365)
				.containsEntry("vector", VECTOR);
		assertThat(column("profile", id)).isEqualTo(JSON.readTree("""
				{"schema": "place-profile/v0",
				 "summary": {"text": "카페, 뷰 시험 카페. 역삼역 근처."},
				 "features": %s,
				 "embedding": {"model": "dragonkue/snowflake-arctic-embed-l-v2.0-ko",
				               "revision": "55ec6e9358a56d56af759bc8372e970caf8c305f",
				               "prompt": "document"}}""".formatted(FEATURES)));
	}

	@Test
	@DisplayName("AI뷰_표의편의시설이름은_코드true로바뀌고그밖의이름은버린다")
	void view_knownFacilityNames_mappedToTrueCodes() {
		long id = insertPlace("주차", "무선 인터넷", "단체 이용 가능", "예약", "콜키지 가능");
		insertProfile(id);

		assertThat(column("facilities", id)).isEqualTo(JSON.readTree("""
				{"PARKING": true, "WIFI": true, "GROUP": true, "RESERVATION": true}"""));
	}

	@Test
	@DisplayName("AI뷰_발렛파킹만있으면_주차로본다")
	void view_valetParkingOnly_mappedToParking() {
		long id = insertPlace("발렛파킹");
		insertProfile(id);

		assertThat(column("facilities", id)).isEqualTo(JSON.readTree("{\"PARKING\": true}"));
	}

	@Test
	@DisplayName("AI뷰_표의이름이없는장소는_시설키가없다")
	void view_noKnownFacilityNames_emptyObject() {
		long id = insertPlace("포장");
		insertProfile(id);

		assertThat(column("facilities", id)).isEqualTo(JSON.readTree("{}"));
	}

	@Test
	@DisplayName("AI뷰_프로필이없는장소는_행이없다")
	void view_placeWithoutProfile_noRow() {
		long id = insertPlace("주차");

		assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_place_search WHERE place_id = ?", Integer.class, id))
				.isZero();
	}
}
