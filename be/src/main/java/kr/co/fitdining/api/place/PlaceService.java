package kr.co.fitdining.api.place;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
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

	public PlaceDetailResponse getPlace(long id) {
		return engine.findPlace(id).orElseThrow(PlaceNotFoundException::new);
	}

	public List<Long> placeIds() {
		return engine.placeIds();
	}

}
