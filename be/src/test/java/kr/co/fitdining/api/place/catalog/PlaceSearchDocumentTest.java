package kr.co.fitdining.api.place.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PlaceSearchDocumentTest {

	private static PlaceSearchDocument document(CategoryGroup group, Station station, String naverCategory) {
		return new PlaceSearchDocument(new PlaceSummary(1L, "이름", group, station, 37.5, 127.0, null), List.of("메뉴"),
				naverCategory);
	}

	@Test
	@DisplayName("검색문서_업종이름은_그룹한글명과코드와네이버업종이다")
	void categoryNames_withNaverCategory_groupNameCodeAndNaverCategory() {
		assertThat(document(CategoryGroup.RESTAURANT, Station.YEOKSAM, "베트남음식").categoryNames())
				.containsExactly("식당", "restaurant", "베트남음식");
		assertThat(document(CategoryGroup.CAFE, Station.YEOKSAM, "카페").categoryNames())
				.containsExactly("카페", "cafe", "카페");
		assertThat(document(CategoryGroup.BAR, Station.YEOKSAM, null).categoryNames()).containsExactly("술집", "bar");
		assertThat(document(CategoryGroup.BAR, Station.YEOKSAM, " ").categoryNames()).containsExactly("술집", "bar");
	}

	@Test
	@DisplayName("검색문서_위치이름은_역이름과역을붙인형태다")
	void locationNames_everyStation_nameAndNameWithYeok() {
		assertThat(document(CategoryGroup.CAFE, Station.GANGNAM, null).locationNames()).containsExactly("강남", "강남역");
		assertThat(document(CategoryGroup.CAFE, Station.YEOKSAM, null).locationNames()).containsExactly("역삼", "역삼역");
		assertThat(document(CategoryGroup.CAFE, Station.SEOLLEUNG, null).locationNames())
				.containsExactly("선릉", "선릉역");
	}

	@Test
	@DisplayName("검색문서_위치이름은_서울강남권의다른역도같은꼴이다")
	void locationNames_seoulStations_nameAndNameWithYeok() {
		assertThat(document(CategoryGroup.CAFE, Station.SINNONHYEON, null).locationNames())
				.containsExactly("신논현", "신논현역");
		assertThat(document(CategoryGroup.CAFE, Station.SAMSEONG_JUNGANG, null).locationNames())
				.containsExactly("삼성중앙", "삼성중앙역");
		assertThat(document(CategoryGroup.CAFE, Station.BONGEUNSA, null).locationNames())
				.containsExactly("봉은사", "봉은사역");
	}

	@Test
	@DisplayName("검색문서_가까운역이없는장소의위치이름은_비어있다")
	void locationNames_noStation_isEmpty() {
		assertThat(document(CategoryGroup.CAFE, null, null).locationNames()).isEmpty();
	}

	@Test
	@DisplayName("검색문서_위치이름은_대전과구미와부산의역도같은꼴이다")
	void locationNames_regionStations_nameAndNameWithYeok() {
		assertThat(document(CategoryGroup.CAFE, Station.YUSEONG_ONCHEON, null).locationNames())
				.containsExactly("유성온천", "유성온천역");
		assertThat(document(CategoryGroup.CAFE, Station.DAEJEON_WORLDCUP_STADIUM, null).locationNames())
				.containsExactly("월드컵경기장", "월드컵경기장역");
		assertThat(document(CategoryGroup.CAFE, Station.GUMI, null).locationNames()).containsExactly("구미", "구미역");
		assertThat(document(CategoryGroup.CAFE, Station.SEOMYEON, null).locationNames())
				.containsExactly("서면", "서면역");
	}

}
