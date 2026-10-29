package kr.co.fitdining.api.place.catalog;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;

/**
 * 키워드 검색 문서. 장소 하나의 검색 대상 값이다. 나중에 OpenSearch 색인 문서로도 쓸 수 있도록 정규화 전의 값을 담는다.
 *
 * @param place 응답에 쓰는 장소 요약. 이름 필드의 출처이기도 하다.
 * @param menuNames 메뉴 이름(원본 순서)
 * @param naverCategory 네이버 업종 이름. 없으면 null이다.
 */
public record PlaceSearchDocument(PlaceSummary place, List<String> menuNames, String naverCategory) {

	private static final Map<CategoryGroup, String> CATEGORY_NAMES = Map.of(
			CategoryGroup.RESTAURANT, "식당",
			CategoryGroup.CAFE, "카페",
			CategoryGroup.BAR, "술집");

	private static final Map<Station, String> STATION_NAMES = Map.of(
			Station.GANGNAM, "강남",
			Station.YEOKSAM, "역삼",
			Station.SEOLLEUNG, "선릉");

	/** 업종 이름들: 그룹 한글명, 그룹 코드(소문자), 네이버 업종 이름(있을 때). */
	public List<String> categoryNames() {
		List<String> names = new ArrayList<>();
		names.add(CATEGORY_NAMES.get(place.categoryGroup()));
		names.add(place.categoryGroup().name().toLowerCase(Locale.ROOT));
		if (naverCategory != null && !naverCategory.isBlank()) {
			names.add(naverCategory);
		}
		return names;
	}

	/** 위치 이름들: 역 이름과 "역"을 붙인 형태. */
	public List<String> locationNames() {
		String name = STATION_NAMES.get(place.station());
		return List.of(name, name + "역");
	}

}
