package kr.co.fitdining.api.place.exception;

/**
 * {@link kr.co.fitdining.api.place.engine.PlaceSearchEngine} 구현이 이 요청에 응답할 수 없을 때 던진다. 예를 들어
 * 키워드 검색이 검색 문서를 한 번도 읽지 못했을 때다.
 */
public class PlaceSearchUnavailableException extends RuntimeException {
}
