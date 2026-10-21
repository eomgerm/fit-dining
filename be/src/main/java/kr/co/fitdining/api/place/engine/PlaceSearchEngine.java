package kr.co.fitdining.api.place.engine;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;

/**
 * 장소 검색의 교체 지점. 지금은 Mock 구현만 있고, AI 파트의 검색이 확정되면 구현을 바꾼다.
 * 구현이 바뀌면 시그니처도 바뀔 수 있다(D-62).
 *
 * <p>컨트롤러와 {@code PlaceService}는 구현이 돌려준 값을 검증하거나 가공하지 않고 그대로 응답한다.
 */
public interface PlaceSearchEngine {

	/**
	 * 입력 중인 문장에 맞는 장소 후보와 "이 조건으로 추천받기" 항목을 돌려준다.
	 *
	 * @param q 사용자가 입력 중인 문장. 형식 검증(1~200자, 공백만 있는 값 제외)을 통과한 값이다.
	 * @return 자동완성 후보 목록. 화면에 보일 순서대로다.
	 */
	List<PlaceSuggestResponse> suggest(String q);

	/**
	 * 자연어 요청으로 장소를 추천한다. 후속 조건과 다음 페이지 요청도 이 메서드로 받는다.
	 *
	 * @param request 추천 검색 요청. {@code previousConditions}와 {@code cursor}는 구현만 해석한다.
	 * @return 추천 결과. 첫 페이지에 결과가 없으면 빈 {@code items}와 {@code emptyReason}을 담고,
	 *         커서로 넘어간 페이지가 비면 {@code emptyReason} 없이 빈 {@code items}만 담는다.
	 * @throws InvalidCursorException {@code cursor}를 해석할 수 없을 때. 400으로 응답한다.
	 */
	PlaceSearchResponse search(PlaceSearchRequest request);

}
