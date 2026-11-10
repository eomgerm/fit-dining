package kr.co.fitdining.api.place.engine;

/**
 * 추천 검색 요청의 목적. API 주소가 정하고, 엔진과 AI 클라이언트가 이 값으로 AI 요청과 대체 결과를 고른다(place-ai-search D-18).
 */
public enum SearchPurpose {

	/** 홈 주변 카드({@code POST /api/v1/places/nearby}). 지도 영역 안 장소를 10곳까지 준다. */
	NEARBY,

	/** 새 검색과 후속 검색({@code POST /api/v1/places/search}). */
	SEARCH,

	/** "이 지역에서 검색"({@code POST /api/v1/places/search/region}). 보던 조건을 지도 영역 안에서 다시 찾는다. */
	REGION;

	/** NEARBY 요청에서 BE가 AI에 보내는 검색 문장. FE·BE 계약이 아니라 BE 안의 상수다. */
	public static final String NEARBY_QUERY = "근처 맛집";

}
