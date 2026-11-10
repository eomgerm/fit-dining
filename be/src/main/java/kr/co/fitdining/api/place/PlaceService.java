package kr.co.fitdining.api.place;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceNearbyRequest;
import kr.co.fitdining.api.place.dto.PlaceRegionSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import kr.co.fitdining.api.place.engine.PlaceSearchResult;
import kr.co.fitdining.api.place.engine.SearchPurpose;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 장소 존재 여부(404)만 판단하고, 엔진이 돌려준 값은 가공하지 않는다. 엔진 빈은 환경마다 정확히 하나다(Mock이 켜졌으면
 * Mock, 아니면 DB 모드의 {@code CatalogPlaceSearchEngine}). 엔진이 던지는 503 예외는 그대로 올라간다.
 */
@Service
@RequiredArgsConstructor
public class PlaceService {

	private final PlaceSearchEngine engine;

	public List<PlaceSuggestResponse> suggest(String q) {
		return engine.suggest(q);
	}

	public PlaceSearchResult search(PlaceSearchRequest request, String userId) {
		return engine.search(SearchPurpose.SEARCH, request, userId);
	}

	/** 홈 주변 카드. 검색 문장은 BE 상수이고 지도 영역은 검증된 네 값이다. */
	public PlaceSearchResult nearby(PlaceNearbyRequest request, String userId) {
		return engine.search(SearchPurpose.NEARBY, new PlaceSearchRequest(SearchPurpose.NEARBY_QUERY,
				request.preferences(), null, request.mapBounds().toMapBounds(), null), userId);
	}

	/** "이 지역에서 검색". 보던 결과의 조건을 엔진 요청의 {@code previousConditions}로 넘긴다. */
	public PlaceSearchResult region(PlaceRegionSearchRequest request, String userId) {
		return engine.search(SearchPurpose.REGION, new PlaceSearchRequest(request.query(), request.preferences(),
				request.conditions(), request.mapBounds().toMapBounds(), request.cursor()), userId);
	}

	public PlaceDetailResponse getPlace(long id) {
		return engine.findPlace(id).orElseThrow(PlaceNotFoundException::new);
	}

	public List<Long> placeIds() {
		return engine.placeIds();
	}

}
