package kr.co.fitdining.api.place.catalog;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;

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
	 * 첫 화면 주변 카드의 후보. 서버가 위치를 모르므로 카탈로그 전체를 돌려주고 FE가 거른다.
	 *
	 * @return 카탈로그 전체의 카드({@code place_id} 오름차순). 점수, 라벨, 이유는 비어 있다.
	 */
	List<PlaceCard> nearbyCandidates();

	/**
	 * 키워드 검색 문서 전체를 읽는다.
	 *
	 * @return 카탈로그 전체의 검색 문서({@code place_id} 오름차순)
	 */
	List<PlaceSearchDocument> loadSearchDocuments();

}
