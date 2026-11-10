package kr.co.fitdining.api.place.engine;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;

/**
 * 장소 검색의 교체 지점. 구현은 Mock({@code place.mock.enabled=true})과 카탈로그 DB 모드 둘이고 환경마다 정확히
 * 하나만 쓰인다. DB 모드의 추천 검색은 AI 검색 API를 부른다(place-ai-search).
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
	 * 자연어 요청으로 장소를 추천한다. 홈 주변 카드, "이 지역에서 검색", 후속 조건과 다음 페이지 요청도 이 메서드로 받는다.
	 *
	 * @param purpose 요청의 목적. 목적마다 AI 요청, 대체 결과, Mock 응답이 다르다(place-ai-search D-18).
	 * @param request 추천 검색 요청. {@code previousConditions}와 {@code cursor}는 구현만 해석한다. NEARBY는
	 *        {@code query}가 {@link SearchPurpose#NEARBY_QUERY}이고 {@code mapBounds}의 네 값이 모두 검증돼 있다. REGION은
	 *        보던 결과의 {@code conditions}를 {@code previousConditions}로 담고 {@code mapBounds}의 네 값이 모두 검증돼 있다.
	 * @param userId 검증된 토큰이나 로그인 세션의 사용자 id. 비회원이면 null이다.
	 * @return 추천 결과와 {@code X-Fallback} 값. 첫 페이지에 결과가 없으면 빈 {@code items}와 {@code emptyReason}을
	 *         담고, 커서로 넘어간 페이지가 비면 {@code emptyReason} 없이 빈 {@code items}만 담는다.
	 * @throws InvalidCursorException {@code cursor}를 해석할 수 없을 때. 400으로 응답한다.
	 * @throws kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException 이 구현이 지금 이 요청에
	 *         응답할 수 없을 때. 503으로 응답한다.
	 */
	PlaceSearchResult search(SearchPurpose purpose, PlaceSearchRequest request, String userId);

	/**
	 * 장소 상세를 찾는다.
	 *
	 * @param id 장소 id
	 * @return 장소 상세. 없는 id면 빈 값이고, 이때 {@code PlaceService}가 404로 응답한다.
	 */
	Optional<PlaceDetailResponse> findPlace(long id);

	/**
	 * 상세를 열 수 있는 모든 장소의 id. 장소 sitemap이 쓴다.
	 *
	 * @return 장소 id 목록(오름차순)
	 */
	List<Long> placeIds();

}
