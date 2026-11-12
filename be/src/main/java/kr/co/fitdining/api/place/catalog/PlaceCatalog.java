package kr.co.fitdining.api.place.catalog;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;

/**
 * 장소 카탈로그를 읽는 포트(읽기 전용). 지금은 Postgres(JdbcClient)가 구현한다.
 */
public interface PlaceCatalog {

	/**
	 * 장소 상세를 읽는다. 핏 점수와 추천 이유는 담지 않는다.
	 *
	 * @param id 장소 id
	 * @return 장소 상세. 없는 id면 빈 값이다.
	 */
	Optional<PlaceDetailResponse> findPlace(long id);

	/**
	 * 여러 장소의 상세를 한 번에 읽는다. 모임 결과 카드가 쓴다(meetup D-29). 내용은 장소마다 {@link #findPlace}로 읽은 것과
	 * 같다.
	 *
	 * @param ids 장소 id
	 * @return id별 상세({@code place_id} 오름차순). 없는 id는 빠진다.
	 */
	default Map<Long, PlaceDetailResponse> findPlaces(Collection<Long> ids) {
		Map<Long, PlaceDetailResponse> found = new LinkedHashMap<>();
		ids.stream().distinct().sorted().forEach(id -> findPlace(id).ifPresent(detail -> found.put(id, detail)));
		return found;
	}

	/**
	 * AI가 읽는 뷰({@code ai_place_search})에 가게 가격이 있는 장소가 하나라도 있는지. 모임의 메뉴 가격 질문을 보일지 정한다
	 * (meetup D-17).
	 */
	default boolean storePricesKnown() {
		return false;
	}

	/**
	 * 카탈로그에 있는 모든 장소의 id. 장소 sitemap이 쓴다.
	 *
	 * @return 장소 id 목록({@code place_id} 오름차순)
	 */
	List<Long> placeIds();

	/**
	 * 첫 화면 주변 카드의 후보. 서버가 위치를 모르므로 카탈로그 전체를 돌려주고 FE가 거른다.
	 *
	 * @return 카탈로그 전체의 카드({@code place_id} 오름차순). 점수, 라벨, 이유는 비어 있다.
	 */
	List<PlaceCard> nearbyCandidates();

	/**
	 * id 목록의 장소를 한 번에 읽어 카드로 만든다. AI 결과와 대체 결과의 카드에 장소 요약과 영업 상태를 붙인다.
	 *
	 * @param ids 장소 id 목록
	 * @return 카탈로그에 있는 id의 카드({@code place_id} 오름차순). 없는 id는 빠진다. 점수, 라벨, 이유는 비어 있다.
	 */
	List<PlaceCard> cards(Collection<Long> ids);

	/**
	 * 지도 영역 안 장소를 앞에서 정해진 수만 카드로 읽는다. AI 대신 처리하는 NEARBY·REGION 대체 결과가 쓴다(place-ai-search
	 * D-6). 영역과 개수는 DB에서 거르고, 좌표는 SQL에 바인딩해 오류 메시지와 로그에 남지 않게 한다.
	 *
	 * @param area 지도 영역. 네 값이 모두 있다. 경계에 있는 장소도 영역 안이다.
	 * @param limit 읽을 최대 장소 수
	 * @return 영역 안 장소의 카드({@code place_id} 오름차순, 최대 {@code limit}개). 점수, 라벨, 이유는 비어 있다.
	 */
	List<PlaceCard> cardsWithin(MapBounds area, int limit);

	/**
	 * 키워드 검색 문서 전체를 읽는다.
	 *
	 * @return 카탈로그 전체의 검색 문서({@code place_id} 오름차순)
	 */
	List<PlaceSearchDocument> loadSearchDocuments();

	/**
	 * 장소가 하나라도 있는 역과 동을 읽는다. 모임 추천의 지역 찾기가 쓴다(meetup spec AC-1).
	 *
	 * @return 장소의 가까운 역(중복 없음, 코드 순)과 동 이름(중복 없음, 이름 순)
	 */
	PlaceAreaNames areaNames();

}
