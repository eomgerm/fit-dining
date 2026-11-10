package kr.co.fitdining.api.place.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 카탈로그 DB로 응답하는 DB 모드의 엔진(place-lookup-db). 조립만 한다. 자동완성은 {@link PlaceKeywordSearch}, 상세와
 * 카드의 장소 정보는 {@link PlaceCatalog}, 추천 검색은 {@link AiSearchClient}가 맡는다. AI가 실패하면 키워드나 카탈로그로
 * 만든 대체 결과와 {@code X-Fallback: AI_UNAVAILABLE}을 준다(place-ai-search D-6). DB 오류는 대체하지 않고 올려 보낸다.
 */
@Slf4j
@Component
@ConditionalOnCatalogMode
@RequiredArgsConstructor
public class CatalogPlaceSearchEngine implements PlaceSearchEngine {

	static final String ACTION_LABEL = "이 조건으로 추천받기";
	static final int SUGGEST_LIMIT = 5;
	static final int FALLBACK_LIMIT = 20;
	static final int NEARBY_LIMIT = 10;
	static final String AI_UNAVAILABLE = "AI_UNAVAILABLE";
	static final EmptyReason FALLBACK_EMPTY_REASON = new EmptyReason(
			"지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요",
			"가게 이름이나 메뉴 이름으로 다시 검색해 보세요");
	static final EmptyReason AREA_EMPTY_REASON = new EmptyReason(
			"이 지역에는 아직 보여 드릴 장소가 없어요",
			"지도를 옮기거나 넓혀서 다시 찾아 보세요");

	private final PlaceCatalog catalog;
	private final PlaceKeywordSearch keywordSearch;
	private final AiSearchClient aiClient;

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

	/**
	 * {@code cursor}가 null이 아니면(빈 문자열 포함) AI를 부르지 않고 400이다. 그 밖에는 요청마다 AI를 부른다.
	 */
	@Override
	public PlaceSearchResult search(SearchPurpose purpose, PlaceSearchRequest request, String userId) {
		if (request.cursor() != null) {
			throw new InvalidCursorException();
		}
		Optional<AiSearchClient.Response> ai;
		try {
			ai = aiClient.search(purpose, request, userId);
		} catch (RuntimeException e) {
			log.error("AI search failed: kind=INVALID, reason={}", e.getClass().getSimpleName());
			ai = Optional.empty();
		}
		if (ai.isPresent()) {
			PlaceSearchResponse response = aiResponse(purpose, ai.get());
			if (response != null) {
				List<String> fallbacks = ai.get().fallbacks();
				return new PlaceSearchResult(response,
						fallbacks == null || fallbacks.isEmpty() ? null : String.join(",", fallbacks));
			}
		}
		return new PlaceSearchResult(fallback(purpose, request), AI_UNAVAILABLE);
	}

	/**
	 * AI 카드에 장소 정보와 영업 상태를 붙인다. NEARBY는 카탈로그 확인을 마친 카드에서 앞 10곳만 남긴다(place-ai-search AC-32).
	 * 카드가 있는데 id가 전부 카탈로그에 없으면 null이다(대체한다).
	 */
	private PlaceSearchResponse aiResponse(SearchPurpose purpose, AiSearchClient.Response ai) {
		log.info("AI search answered: interpretedBy={}, rankedBy={}, models={}", ai.interpretedBy(), ai.rankedBy(),
				ai.models());
		Map<Long, AiSearchClient.Item> items = new LinkedHashMap<>();
		ai.items().forEach(item -> items.putIfAbsent(item.placeId(), item));
		Map<Long, PlaceCard> places = byId(catalog.cards(List.copyOf(items.keySet())));
		int missing = items.size() - places.size();
		if (missing > 0) {
			log.warn("AI search returned places missing from the catalog: count={}", missing);
		}
		if (!items.isEmpty() && places.isEmpty()) {
			return null;
		}
		List<PlaceCard> cards = items.values().stream()
				.filter(item -> places.containsKey(item.placeId()))
				.map(item -> {
					PlaceCard place = places.get(item.placeId());
					return new PlaceCard(place.place(), item.score(), orEmpty(item.labels()), null, place.openStatus(),
							orEmpty(item.reasons()), orEmpty(item.scoreItems()));
				})
				.limit(purpose == SearchPurpose.NEARBY ? NEARBY_LIMIT : Long.MAX_VALUE)
				.toList();
		return new PlaceSearchResponse(ai.conditions() != null ? ai.conditions() : Map.of(),
				Boolean.TRUE.equals(ai.nearby()), cards.size(), cards, null, ai.emptyReason(), ai.changeSummary());
	}

	/**
	 * 점수 없는 대체 결과(place-ai-search AC-9 ~ AC-12). SEARCH는 키워드 검색이고 지도 영역을 보지 않는다.
	 * NEARBY와 REGION은 지도 영역 안 장소를 {@code place_id} 순서로 각각 10곳, 20곳 주고 조건은 비운다.
	 */
	private PlaceSearchResponse fallback(SearchPurpose purpose, PlaceSearchRequest request) {
		if (purpose == SearchPurpose.SEARCH) {
			return keywordFallback(request);
		}
		boolean nearby = purpose == SearchPurpose.NEARBY;
		List<PlaceCard> cards = catalog.cardsWithin(request.mapBounds(), nearby ? NEARBY_LIMIT : FALLBACK_LIMIT);
		return new PlaceSearchResponse(Map.of(), nearby, cards.size(), cards, null,
				cards.isEmpty() ? AREA_EMPTY_REASON : null, null);
	}

	/** 키워드 검색 히트의 앞 20곳을 카탈로그에서 읽어 순위 순서대로 카드로 만든다. */
	private PlaceSearchResponse keywordFallback(PlaceSearchRequest request) {
		Map<String, Object> previous = request.previousConditions();
		List<Long> ids = keywordSearch.search(request.query(), 0, Integer.MAX_VALUE).stream()
				.limit(FALLBACK_LIMIT)
				.map(hit -> hit.place().id())
				.toList();
		Map<Long, PlaceCard> places = byId(catalog.cards(ids));
		List<PlaceCard> cards = ids.stream().map(places::get).filter(Objects::nonNull).toList();
		return new PlaceSearchResponse(previous != null ? previous : Map.of(), false, cards.size(), cards, null,
				cards.isEmpty() ? FALLBACK_EMPTY_REASON : null, null);
	}

	private static Map<Long, PlaceCard> byId(List<PlaceCard> cards) {
		Map<Long, PlaceCard> byId = new HashMap<>();
		cards.forEach(card -> byId.put(card.place().id(), card));
		return byId;
	}

	private static <T> List<T> orEmpty(List<T> list) {
		return list == null ? List.of() : list;
	}

	@Override
	public Optional<PlaceDetailResponse> findPlace(long id) {
		return catalog.findPlace(id);
	}

	@Override
	public List<Long> placeIds() {
		return catalog.placeIds();
	}

}
