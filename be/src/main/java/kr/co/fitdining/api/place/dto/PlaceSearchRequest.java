package kr.co.fitdining.api.place.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import kr.co.fitdining.api.user.Preferences;

/**
 * 추천 검색 요청({@code POST /api/v1/places/search}). 기기 위치 좌표는 어떤 필드에도 담지 않는다.
 *
 * @param query 사용자가 입력한 문장. 1~200자다.
 * @param preferences 비회원이 기기에 저장한 온보딩 답변. 가입과 같은 모양과 검증을 따른다. 비회원이면 AI 요청의
 *        {@code tasteProfile}로 넘기고, 회원이면 검증만 하고 쓰지 않는다(place-ai-search D-4).
 * @param previousConditions 후속 조건일 때, 기준 요청의 응답 {@code conditions}를 그대로 돌려보낸 값.
 *        BE는 내용을 해석하지 않는다. 새 검색이면 없다.
 * @param mapBounds 검색 대상 지역(지도 영역). 사용자의 위치는 아니지만 대략의 위치로 서버에 가므로 로그에 남기지 않는다.
 *        선택이고 검증하지 않는다. FE가 언제 싣는지는 place-search spec이 정한다.
 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}. BE는 해석하지 않고 엔진에 넘긴다.
 */
public record PlaceSearchRequest(
		@NotBlank @Size(max = 200) String query,
		@Valid Preferences preferences,
		Map<String, Object> previousConditions,
		MapBounds mapBounds,
		String cursor
) {

	/**
	 * 검색 대상 지역(지도에 보이는 사각형). 사용자의 위치는 아니지만 대략의 위치다. 이 API에서는 BE가 내용을
	 * 검증하지 않는다(빈 값은 그쪽을 제한하지 않는다).
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
