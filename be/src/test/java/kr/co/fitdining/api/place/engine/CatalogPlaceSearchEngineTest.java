package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CatalogPlaceSearchEngineTest {

	private static final PlaceSummary A = new PlaceSummary(1L, "하노이 쌀국수", CategoryGroup.RESTAURANT, Station.YEOKSAM, 37.5,
			127.03, null);
	private static final PlaceSummary B = new PlaceSummary(2L, "포레스트 키친", CategoryGroup.RESTAURANT, Station.YEOKSAM, 37.5,
			127.03, null);

	private final PlaceCatalog catalog = mock(PlaceCatalog.class);
	private final PlaceKeywordSearch keywordSearch = mock(PlaceKeywordSearch.class);
	private final CatalogPlaceSearchEngine engine = new CatalogPlaceSearchEngine(catalog, keywordSearch);

	private static PlaceSearchRequest request(String query, String cursor, Map<String, Object> previous) {
		return new PlaceSearchRequest(query, null, previous, null, cursor);
	}

	private static PlaceCard card(PlaceSummary place) {
		return new PlaceCard(place, null, List.of(), null, OpenStatus.OPEN, List.of(), List.of());
	}

	@Test
	@DisplayName("자동완성_이름이입력으로시작하는히트가있으면_추천받기가맨뒤다")
	void suggest_namePrefixHit_putsActionLast() {
		when(keywordSearch.search("하노이", 0, 5)).thenReturn(List.of(new PlaceKeywordHit(A, null, true),
				new PlaceKeywordHit(B, "양지 쌀국수", false)));

		List<PlaceSuggestResponse> suggestions = engine.suggest("하노이");

		assertThat(suggestions).extracting(PlaceSuggestResponse::type)
				.containsExactly(SuggestType.PLACE, SuggestType.PLACE, SuggestType.ACTION);
		assertThat(suggestions.get(0).place()).isEqualTo(A);
		assertThat(suggestions.get(0).label()).isNull();
		assertThat(suggestions.get(1).matchedMenu()).isEqualTo("양지 쌀국수");
		assertThat(suggestions.get(2).label()).isEqualTo("이 조건으로 추천받기");
		assertThat(suggestions.get(2).place()).isNull();
	}

	@Test
	@DisplayName("자동완성_이름접두히트가없으면_추천받기가맨위다")
	void suggest_noNamePrefixHit_putsActionFirst() {
		when(keywordSearch.search("쌀국수", 0, 5)).thenReturn(List.of(new PlaceKeywordHit(B, "양지 쌀국수", false)));

		List<PlaceSuggestResponse> suggestions = engine.suggest("쌀국수");

		assertThat(suggestions).extracting(PlaceSuggestResponse::type)
				.containsExactly(SuggestType.ACTION, SuggestType.PLACE);
	}

	@Test
	@DisplayName("자동완성_히트가없으면_추천받기만온다")
	void suggest_noHits_onlyAction() {
		when(keywordSearch.search("없음", 0, 5)).thenReturn(List.of());

		assertThat(engine.suggest("없음")).extracting(PlaceSuggestResponse::type).containsExactly(SuggestType.ACTION);
	}

	@Test
	@DisplayName("자동완성_앞뒤공백을뺀입력으로_처음부터5개를요청한다")
	void suggest_input_requestsFiveHitsFromOffsetZero() {
		when(keywordSearch.search("역삼", 0, 5)).thenReturn(List.of());

		engine.suggest("  역삼  ");

		verify(keywordSearch).search("역삼", 0, 5);
	}

	@Test
	@DisplayName("장소상세_카탈로그에위임한다")
	void findPlace_delegatesToCatalog() {
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(catalog.findPlace(7L)).thenReturn(Optional.of(detail));
		when(catalog.findPlace(8L)).thenReturn(Optional.empty());

		assertThat(engine.findPlace(7L)).containsSame(detail);
		assertThat(engine.findPlace(8L)).isEmpty();
	}

	@Test
	@DisplayName("추천검색_근처요청이면_카탈로그전체를nearby로돌려준다")
	void search_nearbyQuery_returnsEveryCandidateAsNearby() {
		when(catalog.nearbyCandidates()).thenReturn(List.of(card(A), card(B)));

		PlaceSearchResponse response = engine.search(request("근처 맛집", null, null));

		assertThat(response.nearby()).isTrue();
		assertThat(response.totalCount()).isEqualTo(2);
		assertThat(response.items()).hasSize(2);
		assertThat(response.nextCursor()).isNull();
		assertThat(response.emptyReason()).isNull();
		assertThat(response.changeSummary()).isNull();
		assertThat(response.conditions()).isEmpty();
	}

	@Test
	@DisplayName("추천검색_근처요청에이전조건이있으면_그대로돌려준다")
	void search_nearbyQueryWithPreviousConditions_echoesThem() {
		when(catalog.nearbyCandidates()).thenReturn(List.of());

		PlaceSearchResponse response = engine.search(request("근처 맛집", "", Map.of("area", "역삼")));

		assertThat(response.conditions()).containsEntry("area", "역삼");
	}

	@Test
	@DisplayName("추천검색_근처가없는요청은_503예외다")
	void search_otherQuery_throwsUnavailable() {
		assertThatThrownBy(() -> engine.search(request("조용한 데이트 장소", null, null)))
				.isInstanceOf(PlaceSearchUnavailableException.class);
	}

	@Test
	@DisplayName("추천검색_커서가있는요청은_503예외다")
	void search_nearbyQueryWithCursor_throwsUnavailable() {
		assertThatThrownBy(() -> engine.search(request("근처 맛집", "abc", null)))
				.isInstanceOf(PlaceSearchUnavailableException.class);
	}

}
