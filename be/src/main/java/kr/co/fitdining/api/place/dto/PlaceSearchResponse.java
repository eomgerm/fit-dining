package kr.co.fitdining.api.place.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * 추천 검색 응답.
 *
 * @param conditions 엔진이 해석한 검색 조건. BE와 FE는 내용을 해석하지 않고, FE가 다음 후속 요청의
 *        {@code previousConditions}로 그대로 돌려보낸다. 전역 null 생략이 Map 내부 값에도 적용되므로,
 *        받은 값을 내부 null까지 그대로 돌려주도록 이 필드만 내부 생략에서 뺀다(D-61).
 * @param nearby 근처 결과면 true. {@code /places/nearby}의 Mock과 대체 결과는 항상 true이고, AI 성공 응답은 AI 값이다.
 * @param totalCount 전체 결과 수
 * @param items 이번 페이지의 카드. Mock은 점수 내림차순이고 한 번에 최대 20개다. {@code /places/nearby}는 어느
 *        모드에서든 최대 10개다.
 *        DB 모드는 AI 응답 순서이고, AI 대신 처리한 대체 결과의 카드에는 점수가 없다.
 * @param nextCursor 다음 페이지를 요청할 때 보낼 값. 다음 페이지가 있을 때만 있다.
 * @param emptyReason 결과가 없는 이유와 수정 제안. 첫 페이지에 결과가 없을 때만 있고, 커서로 넘어간 빈 페이지에는 없다.
 * @param changeSummary 후속 조건을 반영했음을 알리는 배너 문구. 후속 조건 요청일 때만 있다.
 */
public record PlaceSearchResponse(
		@JsonInclude(content = JsonInclude.Include.ALWAYS) Map<String, Object> conditions,
		Boolean nearby,
		Integer totalCount,
		List<PlaceCard> items,
		String nextCursor,
		EmptyReason emptyReason,
		String changeSummary
) {

	/**
	 * 결과가 없을 때의 원인과 수정 제안.
	 *
	 * @param cause 결과가 없는 원인
	 * @param suggestion 검색어나 조건을 어떻게 바꾸면 좋을지에 대한 제안
	 */
	public record EmptyReason(
			String cause,
			String suggestion
	) {
	}

}
