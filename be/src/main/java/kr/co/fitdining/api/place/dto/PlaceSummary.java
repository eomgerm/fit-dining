package kr.co.fitdining.api.place.dto;

/**
 * 목록, 자동완성, 상세가 함께 쓰는 장소 요약.
 *
 * @param id 장소 id. ERD의 {@code places.place_id}(bigint)를 따르는 정수다.
 * @param name 장소 이름
 * @param categoryGroup 업종
 * @param station 장소가 속한 역
 * @param lat 위도. FE가 지도 핀을 찍고 내 위치와의 거리를 계산하는 데 쓴다.
 * @param lng 경도
 * @param thumbnailUrl 대표 사진 URL. 없으면 생략하고 FE가 자리표시를 그린다.
 */
public record PlaceSummary(
		Long id,
		String name,
		CategoryGroup categoryGroup,
		Station station,
		Double lat,
		Double lng,
		String thumbnailUrl
) {

	/** 업종 */
	public enum CategoryGroup {
		/** 식당 */
		RESTAURANT,
		/** 카페 */
		CAFE,
		/** 술집 */
		BAR
	}

	/** 장소가 속한 역 */
	public enum Station {
		/** 강남역 */
		GANGNAM,
		/** 역삼역 */
		YEOKSAM,
		/** 선릉역 */
		SEOLLEUNG
	}

}
