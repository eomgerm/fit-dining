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
 * @param nearby "근처" 요청이면 true. 이때는 커서 없이 후보 전체가 오고, FE가 현재 위치와 반경으로 거른다.
 * @param totalCount 전체 결과 수
 * @param items 이번 페이지의 카드. Mock은 점수 내림차순이고 한 번에 최대 20개다(근처 요청이면 최대 100개).
 *        DB 모드의 근처 요청은 카탈로그 전체를 {@code place_id} 오름차순으로 담고 카드에 점수가 없다.
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
