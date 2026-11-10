package kr.co.fitdining.api.place.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import kr.co.fitdining.api.user.Preferences;

/**
 * "이 지역에서 검색" 요청({@code POST /api/v1/places/search/region}). 보던 결과의 조건을 지도 영역 안에서 다시 찾는다
 * (place-ai-search D-18).
 *
 * @param query 보던 요청의 문장. 1~200자다.
 * @param conditions 보던 결과의 {@code conditions}. BE는 내용을 해석하지 않는다. 없거나 null이면 조건 없음이다.
 * @param mapBounds 지금 지도 영역. 필수다.
 * @param preferences 비회원이 기기에 저장한 온보딩 답변. 가입과 같은 모양과 검증을 따른다. 없으면 생략한다.
 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}. Mock만 쓰고 DB 모드에서는 있으면 400이다.
 */
public record PlaceRegionSearchRequest(
		@NotBlank @Size(max = 200) String query,
		Map<String, Object> conditions,
		@NotNull @Valid MapArea mapBounds,
		@Valid Preferences preferences,
		String cursor
) {
}
