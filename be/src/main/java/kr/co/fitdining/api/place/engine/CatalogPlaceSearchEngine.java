package kr.co.fitdining.api.place.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 카탈로그 DB로 응답하는 DB 모드의 엔진(place-lookup-db). 조립만 한다. 자동완성은 {@link PlaceKeywordSearch}, 상세와
 * 주변 후보는 {@link PlaceCatalog}가 맡는다. 자연어 검색은 AI 엔진이 붙을 때까지 없어서 "근처" 요청 말고는 503이다.
 */
@Component
@ConditionalOnCatalogMode
@RequiredArgsConstructor
public class CatalogPlaceSearchEngine implements PlaceSearchEngine {

	static final String ACTION_LABEL = "이 조건으로 추천받기";
	static final int SUGGEST_LIMIT = 5;
	static final String NEARBY_KEYWORD = "근처";

	private final PlaceCatalog catalog;
	private final PlaceKeywordSearch keywordSearch;

	@Override
	public List<PlaceSuggestResponse> suggest(String q) {
		List<PlaceKeywordHit> hits = keywordSearch.search(q.strip(), 0, SUGGEST_LIMIT);
		List<PlaceSuggestResponse> suggestions = new ArrayList<>();
		for (PlaceKeywordHit hit : hits) {
			suggestions.add(new PlaceSuggestResponse(SuggestType.PLACE, hit.place(), hit.matchedMenu(), null));
		}
		PlaceSuggestResponse action = new PlaceSuggestResponse(SuggestType.ACTION, null, null, ACTION_LABEL);
		if (!hits.isEmpty() && Boolean.TRUE.equals(hits.get(0).namePrefix())) {
			suggestions.add(action);
		} else {
			suggestions.addFirst(action);
		}
		return suggestions;
	}

	@Override
	public PlaceSearchResponse search(PlaceSearchRequest request) {
		boolean paging = request.cursor() != null && !request.cursor().isEmpty();
		if (paging || !request.query().contains(NEARBY_KEYWORD)) {
			throw new PlaceSearchUnavailableException();
		}
		List<PlaceCard> candidates = catalog.nearbyCandidates();
		Map<String, Object> previous = request.previousConditions();
		return new PlaceSearchResponse(previous != null ? previous : Map.of(), true, candidates.size(), candidates,
				null, null, null);
	}

	@Override
	public Optional<PlaceDetailResponse> findPlace(long id) {
		return catalog.findPlace(id);
	}

}
