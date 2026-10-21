package kr.co.fitdining.api.place.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

/**
 * 추천 검색 요청. 기기 위치 좌표는 어떤 필드에도 담지 않는다.
 *
 * @param query 사용자가 입력한 문장. 1~200자다.
 * @param preferences 사용자 취향 태그 코드 목록. Mock은 받기만 하고 결과에 반영하지 않는다.
 * @param previousConditions 후속 조건일 때, 기준 요청의 응답 {@code conditions}를 그대로 돌려보낸 값.
 *        BE는 내용을 해석하지 않는다. 새 검색이면 없다.
 * @param mapBounds 검색 대상 지역. "이 지역에서 검색"을 눌렀거나 위치를 얻지 못했을 때만 보낸다.
 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}. BE는 해석하지 않고 엔진에 넘긴다.
 */
public record PlaceSearchRequest(
		@NotBlank @Size(max = 200) String query,
		List<String> preferences,
		Map<String, Object> previousConditions,
		MapBounds mapBounds,
		String cursor
) {

	/**
	 * 검색 대상 지역(지도에 보이는 사각형). 사용자의 위치가 아니다. BE는 내용을 검증하지 않는다.
	 *
	 * @param swLat 남서쪽 모서리 위도
	 * @param swLng 남서쪽 모서리 경도
	 * @param neLat 북동쪽 모서리 위도
	 * @param neLng 북동쪽 모서리 경도
	 */
	public record MapBounds(
			Double swLat,
			Double swLng,
			Double neLat,
			Double neLng
	) {
	}

}
