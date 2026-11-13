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

/**
 * AI가 읽는 뷰 {@code ai_place_search}의 모양(place-ai-search spec "AI가 읽는 뷰", AC-24)을 앱 계정으로 확인한다. 검색 2차
 * 컬럼(V17~V19)과 시·도(V36)도 본다.
 */
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
						"summary_vector", "name", "food_type", "dong", "district", "subways", "hours", "menus",
						"pet_allowed", "parking_free", "corkage_allowed", "price", "analyzed_review_count", "category",
						"sido");
	}

	@Test
	@DisplayName("AI뷰_시도는_지번주소의첫낱말이고지번주소가없으면도로명주소의첫낱말이다")
	void view_sido_firstWordOfJibunThenRoadAddress() {
		long jibun = insertPlace();
		long road = insertPlace();
		long none = insertPlace();
		List.of(jibun, road, none).forEach(this::insertProfile);
		jdbc.update("UPDATE places SET jibun_address = '대전 유성구 봉명동 615-1', address = '대전 유성구 대학로 56' "
				+ "WHERE place_id = ?", jibun);
		jdbc.update("UPDATE places SET address = '전남광주 광산구 수완로11번길 37' WHERE place_id = ?", road);

		assertThat(List.of(jibun, road, none).stream()
				.map(id -> jdbc.queryForObject("SELECT sido FROM ai_place_search WHERE place_id = ?", String.class, id))
				.toList())
				.containsExactly("대전", "전남광주", null);
	}

	@Test
	@DisplayName("AI뷰_분석리뷰수는_장소프로필값그대로다")
	void view_analyzedReviewCount_readsProfileValue() {
		long id = insertPlace();
		insertProfile(id);

		assertThat(jdbc.queryForObject(
				"SELECT analyzed_review_count FROM ai_place_search WHERE place_id = ?", Integer.class, id))
				.isEqualTo(10);
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
	@DisplayName("AI뷰_검색2차장소컬럼은_장소값그대로이고가게가격은모름이다")
	void view_searchPlaceColumns_readPlaceValuesAndUnknownPrice() {
		long id = insertPlace();
		insertProfile(id);
		jdbc.update("""
				UPDATE places SET food_type = 'FOOD_WESTERN', dong = '역삼동', district = '강남구',
				    pet_allowed = true, parking_free = false, category = '카페,디저트'
				WHERE place_id = ?""", id);

		assertThat(jdbc.queryForMap("""
				SELECT name, category, food_type, dong, district, pet_allowed, parking_free, corkage_allowed, price
				FROM ai_place_search WHERE place_id = ?""", id))
				.containsEntry("name", "뷰 시험 카페").containsEntry("category", "카페,디저트")
				.containsEntry("food_type", "FOOD_WESTERN")
				.containsEntry("dong", "역삼동").containsEntry("district", "강남구")
				.containsEntry("pet_allowed", true).containsEntry("parking_free", false)
				.containsEntry("corkage_allowed", null).containsEntry("price", null);
	}

	@Test
	@DisplayName("AI뷰_가까운역영업시간메뉴는_정한순서의JSON목록이다")
	void view_subwaysHoursMenus_aggregatedInOrder() {
		long id = insertPlace();
		insertProfile(id);
		jdbc.update("""
				INSERT INTO place_subways (place_id, station, line, exit, walk_minutes, walk_meters)
				VALUES (?, '역삼역', '2', '3', 4, 280), (?, '강남역', '2', NULL, NULL, NULL)""", id, id);
		jdbc.update("""
				INSERT INTO place_hours (place_id, day_of_week, open_time, close_time, closed, breaks)
				VALUES (?, 'TUE', '18:00', '02:00', false, '[{"start": "15:00", "end": "17:00"}]'),
				       (?, 'MON', NULL, NULL, true, '[]')""", id, id);
		jdbc.update("""
				INSERT INTO place_menus (place_id, sort_order, category, name, price, price_type, representative)
				VALUES (?, 1, NULL, '시가 회', NULL, 'DYNAMIC', false),
				       (?, 0, '파스타', '알리오올리오', 15000, 'FIXED', true)""", id, id);

		// 가까운 역은 원본 순서, 영업시간은 월요일부터, 메뉴는 메뉴판 순서다
		assertThat(column("subways", id)).isEqualTo(JSON.readTree("""
				[{"station": "역삼역", "exit": "3", "walk_minutes": 4},
				 {"station": "강남역", "exit": null, "walk_minutes": null}]"""));
		assertThat(column("hours", id)).isEqualTo(JSON.readTree("""
				[{"day": "MON", "open": null, "close": null, "closed": true, "breaks": []},
				 {"day": "TUE", "open": "18:00", "close": "02:00", "closed": false,
				  "breaks": [{"start": "15:00", "end": "17:00"}]}]"""));
		assertThat(column("menus", id)).isEqualTo(JSON.readTree("""
				[{"name": "알리오올리오", "category": "파스타", "price": 15000, "representative": true},
				 {"name": "시가 회", "category": null, "price": null, "representative": false}]"""));
	}

	@Test
	@DisplayName("AI뷰_가까운역영업시간메뉴가없으면_빈목록이다")
	void view_noSubwaysHoursMenus_emptyArrays() {
		long id = insertPlace();
		insertProfile(id);

		assertThat(column("subways", id)).isEqualTo(JSON.readTree("[]"));
		assertThat(column("hours", id)).isEqualTo(JSON.readTree("[]"));
		assertThat(column("menus", id)).isEqualTo(JSON.readTree("[]"));
	}

	@Test
	@DisplayName("AI뷰_프로필이없는장소는_행이없다")
	void view_placeWithoutProfile_noRow() {
		long id = insertPlace("주차");

		assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_place_search WHERE place_id = ?", Integer.class, id))
				.isZero();
	}
}
