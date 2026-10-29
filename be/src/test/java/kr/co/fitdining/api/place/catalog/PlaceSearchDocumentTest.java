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

}
