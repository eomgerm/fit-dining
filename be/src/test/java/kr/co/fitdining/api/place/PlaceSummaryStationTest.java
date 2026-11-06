package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** {@link Station}이 기준 목록({@link StationCodes#ALL})과 같은 코드와 짧은 이름을 갖는지 확인한다. */
class PlaceSummaryStationTest {

	/** 코드 → "역"을 뺀 한글 이름. 키워드 검색이 위치 이름("유성온천", "유성온천역")으로 쓴다. */
	private static final Map<String, String> SHORT_NAMES = Map.ofEntries(
			Map.entry("GANGNAM", "강남"), Map.entry("YEOKSAM", "역삼"), Map.entry("SEOLLEUNG", "선릉"),
			Map.entry("YUSEONG_ONCHEON", "유성온천"), Map.entry("GUAM", "구암"), Map.entry("NOEUN", "노은"),
			Map.entry("BANSEOK", "반석"), Map.entry("DAEJEON_WORLDCUP_STADIUM", "월드컵경기장"),
			Map.entry("JIJOK", "지족"), Map.entry("GAPCHEON", "갑천"), Map.entry("HYEONCHUNGWON", "현충원"),
			Map.entry("WOLPYEONG", "월평"), Map.entry("GUMI", "구미"), Map.entry("SAGOK", "사곡"),
			Map.entry("JEONPO", "전포"), Map.entry("SEOMYEON", "서면"), Map.entry("GEUMNYEONSAN", "금련산"),
			Map.entry("SASANG", "사상"), Map.entry("HADAN", "하단"), Map.entry("GWANGAN", "광안"),
			Map.entry("NAMPO", "남포"), Map.entry("DONGNAE", "동래"));

	@Test
	@DisplayName("역enum_기준목록과같은코드를같은순서로가진다")
	void stations_sameCodesAsReferenceList() {
		List<String> names = Arrays.stream(Station.values()).map(Enum::name).toList();

		assertThat(names).containsExactlyElementsOf(StationCodes.ALL);
	}

	@Test
	@DisplayName("역enum_짧은이름이모두정해져있고서로겹치지않는다")
	void stations_shortNames_definedAndDistinct() {
		assertThat(SHORT_NAMES.keySet()).containsExactlyInAnyOrderElementsOf(StationCodes.ALL);
		assertThat(Arrays.stream(Station.values())).allSatisfy(
				station -> assertThat(station.shortName()).isEqualTo(SHORT_NAMES.get(station.name())));
		assertThat(Arrays.stream(Station.values()).map(Station::shortName)).doesNotHaveDuplicates();
	}

}
