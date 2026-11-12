package kr.co.fitdining.api.place.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;

/**
 * 상세 추천 이유 요청. 상세를 연 검색 결과 카드의 {@code reasons}와 그 검색의 요청 문장을 그대로 보낸다.
 *
 * @param request 그 검색의 요청 문장(200자 이하). 홈 주변 카드처럼 사용자가 쓴 문장이 없으면 생략한다.
 * @param reasons 검색 결과 카드의 {@code reasons}. 1~4개이고 순서를 바꾸지 않는다.
 */
public record PlaceReasonsRequest(
		@Size(max = 200) String request,
		@NotNull @Size(min = 1, max = 4) List<@NotNull @Valid Reason> reasons
) {
}
