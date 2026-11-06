package kr.co.fitdining.api.place.dto;

/**
 * 목록, 자동완성, 상세가 함께 쓰는 장소 요약.
 *
 * @param id 장소 id. ERD의 {@code places.place_id}(bigint)를 따르는 정수다.
 * @param name 장소 이름
 * @param categoryGroup 업종
 * @param station 장소에서 가장 가까운 역. 가까운 역이 없으면 null이고 JSON에서는 생략한다.
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

	/** 장소에서 가장 가까운 역 */
	public enum Station {
		/** 강남역 */
		GANGNAM("강남"),
		/** 역삼역 */
		YEOKSAM("역삼"),
		/** 선릉역 */
		SEOLLEUNG("선릉"),

		/** 대전 유성온천역(1호선) */
		YUSEONG_ONCHEON("유성온천"),
		/** 대전 구암역 */
		GUAM("구암"),
		/** 대전 노은역 */
		NOEUN("노은"),
		/** 대전 반석역 */
		BANSEOK("반석"),
		/** 대전 월드컵경기장역. 서울 6호선에도 같은 이름이 있어 지역을 붙였다. */
		DAEJEON_WORLDCUP_STADIUM("월드컵경기장"),
		/** 대전 지족역 */
		JIJOK("지족"),
		/** 대전 갑천역 */
		GAPCHEON("갑천"),
		/** 대전 현충원역 */
		HYEONCHUNGWON("현충원"),
		/** 대전 월평역 */
		WOLPYEONG("월평"),

		/** 구미역(대경선) */
		GUMI("구미"),
		/** 사곡역(대경선) */
		SAGOK("사곡"),

		/** 부산 전포역 */
		JEONPO("전포"),
		/** 부산 서면역(1호선, 2호선) */
		SEOMYEON("서면"),
		/** 부산 금련산역 */
		GEUMNYEONSAN("금련산"),
		/** 부산 사상역 */
		SASANG("사상"),
		/** 부산 하단역 */
		HADAN("하단"),
		/** 부산 광안역 */
		GWANGAN("광안"),
		/** 부산 남포역 */
		NAMPO("남포"),
		/** 부산 동래역 */
		DONGNAE("동래");

		private final String shortName;

		Station(String shortName) {
			this.shortName = shortName;
		}

		/** "역"을 뺀 이름. 키워드 검색이 위치 이름으로 쓴다. */
		public String shortName() {
			return shortName;
		}
	}

}
