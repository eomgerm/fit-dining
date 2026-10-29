package kr.co.fitdining.api.place.exception;

/**
 * {@link kr.co.fitdining.api.place.engine.PlaceSearchEngine} 구현이 이 요청에 응답할 수 없을 때 던진다. 예를 들어
 * 카탈로그 DB 모드에서 AI 엔진이 없어 "근처"가 아닌 추천 검색을 받았거나, 검색 문서를 한 번도 읽지 못했을 때다.
 */
public class PlaceSearchUnavailableException extends RuntimeException {
}
