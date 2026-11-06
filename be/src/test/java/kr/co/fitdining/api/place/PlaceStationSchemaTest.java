package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@code places.station}이 받는 값(역 코드 {@link StationCodes#ALL}과 NULL)을 앱 계정으로 확인한다. */
class PlaceStationSchemaTest extends PostgresTestSupport {

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

	private long insertPlace(String naverPlaceId, String station) {
		long id = jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, station, lat, lng)
				VALUES (?, '역 시험 장소', 'CAFE', ?, 37.5, 127.03) RETURNING place_id""", Long.class, naverPlaceId,
				station);
		placeIds.add(id);
		return id;
	}

	@Test
	@DisplayName("장소_정해진역코드는_모두저장된다")
	void insert_everyStationCode_saved() {
		for (String code : StationCodes.ALL) {
			long id = insertPlace("station-schema-" + code, code);

			assertThat(jdbc.queryForObject("SELECT station FROM places WHERE place_id = ?", String.class, id))
					.isEqualTo(code);
		}
	}

	@Test
	@DisplayName("장소_가까운역이없으면_NULL로저장된다")
	void insert_noStation_savedAsNull() {
		long id = insertPlace("station-schema-null", null);

		assertThat(jdbc.queryForObject("SELECT station FROM places WHERE place_id = ?", String.class, id)).isNull();
	}

	@Test
	@DisplayName("장소_역코드가아니면_거부된다")
	void insert_unknownStation_rejected() {
		assertThatThrownBy(() -> insertPlace("station-schema-bad-1", "NOT_A_STATION"))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("ck_places_station");
		// 코드는 대문자 그대로만 받는다. 소문자나 한글 이름은 거부한다
		assertThatThrownBy(() -> insertPlace("station-schema-bad-2", "gangnam"))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("ck_places_station");
		assertThatThrownBy(() -> insertPlace("station-schema-bad-3", "강남역"))
				.isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("ck_places_station");
	}

}
