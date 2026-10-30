package kr.co.fitdining.api.place.engine;

import kr.co.fitdining.api.place.dto.PlaceSearchResponse;

/**
 * 추천 검색 결과와 응답 헤더 {@code X-Fallback}의 값.
 *
 * @param response 응답 본문
 * @param fallback 대신 처리한 이유를 쉼표로 이은 값. 없으면 null이고 헤더를 붙이지 않는다(place-ai-search D-7).
 */
public record PlaceSearchResult(PlaceSearchResponse response, String fallback) {
}
