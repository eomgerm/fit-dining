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

/**
 * AI가 읽는 뷰 {@code ai_place_personas}(V25)의 모양을 앱 계정으로 확인한다. 만족한 손님 페르소나만, 장소 프로필이 있는 장소만
 * 든다(ai/docs/comparison/spec.md 4.2, 4.3).
 */
class AiPlacePersonasViewTest extends PostgresTestSupport {

	private static final String VECTOR = "[" + String.join(",", Collections.nCopies(1024, "0.01")) + "]";

	private static JdbcTemplate jdbc;

	private final List<Long> placeIds = new ArrayList<>();

	@BeforeAll
	static void setUp() throws Exception {
		migrate();
		jdbc = new JdbcTemplate(appSource());
	}

	@AfterEach
	void cleanUp() {
		// 컨테이너를 모든 테스트 클래스가 함께 쓰므로 이 클래스가 넣은 행만 지운다. 프로필과 페르소나는 장소를 따라 지워진다
		placeIds.forEach(id -> jdbc.update("DELETE FROM places WHERE place_id = ?", id));
	}

	private long insertPlace(String categoryGroup) {
		long id = jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, station, lat, lng, facilities)
				VALUES (?, '페르소나 뷰 시험', ?, 'YEOKSAM', 37.5004, 127.0365, '{}')
				RETURNING place_id""", Long.class, UUID.randomUUID().toString(), categoryGroup);
		placeIds.add(id);
		return id;
	}

	private void insertProfile(long placeId) {
		jdbc.update("""
				INSERT INTO place_profiles (place_id, summary_text, summary_vector, features, analyzed_review_count)
				VALUES (?, '페르소나 뷰 시험.', ?::vector, '[]'::jsonb, 10)""", placeId, VECTOR);
	}

	private void insertPersona(long placeId, String personaId, boolean liked) {
		jdbc.update("""
				INSERT INTO place_personas (place_id, persona_id, name, description, reason, liked, vector)
				VALUES (?, ?, '시험 손님', '시험 설명', '시험 이유', ?, ?::vector)""", placeId, personaId, liked, VECTOR);
	}

	private List<String> categories(long placeId) {
		return jdbc.queryForList("SELECT category_group FROM ai_place_personas WHERE place_id = ?", String.class,
				placeId);
	}

	@Test
	@DisplayName("페르소나뷰_컬럼은_AI가읽는이름과순서다")
	void view_columns_matchAiStore() {
		assertThat(jdbc.queryForList("""
				SELECT column_name FROM information_schema.columns
				WHERE table_name = 'ai_place_personas' ORDER BY ordinal_position""", String.class))
				.containsExactly("place_id", "category_group", "vector");
	}

	@Test
	@DisplayName("페르소나뷰_만족한손님페르소나만_장소업종과함께든다")
	void view_likedPersonasOnly_withCategory() {
		long id = insertPlace("BAR");
		insertProfile(id);
		insertPersona(id, "p1", true);
		insertPersona(id, "p2", false);

		assertThat(categories(id)).containsExactly("BAR");
	}

	@Test
	@DisplayName("페르소나뷰_장소프로필이없는장소는_검색에서빠지므로뷰에도없다")
	void view_placeWithoutProfile_excluded() {
		long id = insertPlace("CAFE");
		insertPersona(id, "p1", true);

		assertThat(categories(id)).isEmpty();
	}
}
