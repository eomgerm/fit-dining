package kr.co.fitdining.api.place.dto;

import jakarta.validation.constraints.AssertTrue;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;

/**
 * {@code /places/nearby}와 {@code /places/search/region}이 받는 지도 영역. 검색 대상 지역이지만 대략의 위치이기도 하므로 로그에
 * 남기지 않는다. 네 값이 모두 있고 유한하며 위도 -90~90, 경도 -180~180 안이고 남서쪽이 북동쪽보다 작아야 한다(place-ai-search
 * AC-29). {@code /places/search}의 {@link MapBounds}는 이 검증을 하지 않는다.
 *
 * @param swLat 남서쪽 모서리 위도
 * @param swLng 남서쪽 모서리 경도
 * @param neLat 북동쪽 모서리 위도
 * @param neLng 북동쪽 모서리 경도
 */
public record MapArea(
		Double swLat,
		Double swLng,
		Double neLat,
		Double neLng
) {

	/**
	 * Bean Validation이 읽는 검증. 어기면 400이다.
	 *
	 * @return 네 값이 모두 있고 범위 안이며 남서쪽이 북동쪽보다 작으면 true
	 */
	@AssertTrue
	public boolean isValidArea() {
		return latitude(swLat) && latitude(neLat) && longitude(swLng) && longitude(neLng) && swLat < neLat
				&& swLng < neLng;
	}

	/**
	 * 엔진이 쓰는 지도 영역으로 바꾼다.
	 *
	 * @return 같은 네 값의 {@link MapBounds}
	 */
	public MapBounds toMapBounds() {
		return new MapBounds(swLat, swLng, neLat, neLng);
	}

	private static boolean latitude(Double value) {
		return value != null && Double.isFinite(value) && value >= -90 && value <= 90;
	}

	private static boolean longitude(Double value) {
		return value != null && Double.isFinite(value) && value >= -180 && value <= 180;
	}

}
