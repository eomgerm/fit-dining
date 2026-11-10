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
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.dto.PlaceSummary;
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
	static final String HOME_QUERY = "근처 맛집";
	static final int FALLBACK_LIMIT = 20;
	static final String AI_UNAVAILABLE = "AI_UNAVAILABLE";
	static final EmptyReason FALLBACK_EMPTY_REASON = new EmptyReason(
			"지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요",
			"가게 이름이나 메뉴 이름으로 다시 검색해 보세요");

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
			PlaceSearchResponse response = aiResponse(ai.get());
			if (response != null) {
				List<String> fallbacks = ai.get().fallbacks();
				return new PlaceSearchResult(response,
						fallbacks == null || fallbacks.isEmpty() ? null : String.join(",", fallbacks));
			}
		}
		return new PlaceSearchResult(fallback(request), AI_UNAVAILABLE);
	}

	/** AI 카드에 장소 정보와 영업 상태를 붙인다. 카드가 있는데 id가 전부 카탈로그에 없으면 null이다(대체한다). */
	private PlaceSearchResponse aiResponse(AiSearchClient.Response ai) {
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
				.toList();
		return new PlaceSearchResponse(ai.conditions() != null ? ai.conditions() : Map.of(),
				Boolean.TRUE.equals(ai.nearby()), cards.size(), cards, null, ai.emptyReason(), ai.changeSummary());
	}

	/** 홈 요청은 카탈로그 전체, 그 밖은 키워드 검색 결과다. 점수 없이 지도 영역으로만 거른다(AC-9 ~ AC-12). */
	private PlaceSearchResponse fallback(PlaceSearchRequest request) {
		MapBounds bounds = request.mapBounds();
		Map<String, Object> previous = request.previousConditions();
		boolean home = request.query().strip().equals(HOME_QUERY) && (previous == null || previous.isEmpty());
		List<PlaceCard> cards;
		if (home) {
			cards = catalog.nearbyCandidates().stream().filter(card -> within(card.place(), bounds)).toList();
		} else {
			List<Long> ids = keywordSearch.search(request.query(), 0, Integer.MAX_VALUE).stream()
					.map(PlaceKeywordHit::place)
					.filter(place -> within(place, bounds))
					.limit(FALLBACK_LIMIT)
					.map(PlaceSummary::id)
					.toList();
			Map<Long, PlaceCard> places = byId(catalog.cards(ids));
			cards = ids.stream().map(places::get).filter(Objects::nonNull).toList();
		}
		return new PlaceSearchResponse(previous != null ? previous : Map.of(), home, cards.size(), cards, null,
				cards.isEmpty() ? FALLBACK_EMPTY_REASON : null, null);
	}

	/** 위도·경도가 영역 안(경계 포함)이다. 빈 값은 그쪽을 제한하지 않는다. */
	private static boolean within(PlaceSummary place, MapBounds bounds) {
		return bounds == null || (inRange(place.lat(), bounds.swLat(), bounds.neLat())
				&& inRange(place.lng(), bounds.swLng(), bounds.neLng()));
	}

	/** 경계가 있는데 좌표가 없으면 밖이다. */
	private static boolean inRange(Double value, Double min, Double max) {
		if (min == null && max == null) {
			return true;
		}
		return value != null && (min == null || value >= min) && (max == null || value <= max);
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
