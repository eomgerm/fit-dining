package kr.co.fitdining.api.place.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import kr.co.fitdining.api.user.Preferences;

/**
 * 홈 주변 카드 요청({@code POST /api/v1/places/nearby}). 검색 문장은 받지 않고 BE가 정한다(place-ai-search D-18).
 *
 * @param mapBounds 지금 지도 영역. 필수다.
 * @param preferences 비회원이 기기에 저장한 온보딩 답변. 가입과 같은 모양과 검증을 따른다. 없으면 생략한다.
 */
public record PlaceNearbyRequest(
		@NotNull @Valid MapArea mapBounds,
		@Valid Preferences preferences
) {
}
