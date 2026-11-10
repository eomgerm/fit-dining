package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceCard.ReasonTag;
import kr.co.fitdining.api.place.dto.PlaceCard.ScoreItem;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;

@ExtendWith(OutputCaptureExtension.class)
class CatalogPlaceSearchEngineTest {

	private static final PlaceSummary A = new PlaceSummary(1L, "하노이 쌀국수", CategoryGroup.RESTAURANT, Station.YEOKSAM, 37.5,
			127.03, null);
	private static final PlaceSummary B = new PlaceSummary(2L, "포레스트 키친", CategoryGroup.RESTAURANT, Station.YEOKSAM, 37.5,
			127.03, null);

	private final PlaceCatalog catalog = mock(PlaceCatalog.class);
	private final PlaceKeywordSearch keywordSearch = mock(PlaceKeywordSearch.class);
	private final AiSearchClient aiClient = mock(AiSearchClient.class);
	private final CatalogPlaceSearchEngine engine = new CatalogPlaceSearchEngine(catalog, keywordSearch, aiClient);

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

	@Nested
	@DisplayName("AI 호출")
	class AiCall {

		@Test
		@DisplayName("추천검색_홈요청도_요청마다AI를부르고결과를다시쓰지않는다")
		void search_homeQuery_callsAiEveryTime() {
			ai(response(List.of(item(1L))));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.OPEN)));

			engine.search(SearchPurpose.SEARCH, request("근처 맛집"), null);
			engine.search(SearchPurpose.SEARCH, request("근처 맛집"), null);

			verify(aiClient, times(2)).search(any(), any(), any());
			verify(catalog, never()).nearbyCandidates();
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "abc"})
		@DisplayName("추천검색_cursor가null이아니면_AI를부르지않고400예외다")
		void search_cursor_throwsInvalidCursorWithoutAi(String cursor) {
			assertThatThrownBy(() -> engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest("근처 맛집", null, null, null, cursor), null))
					.isInstanceOf(InvalidCursorException.class);
			verifyNoInteractions(aiClient);
		}

		@Test
		@DisplayName("추천검색_넘겨받은회원id만_AI클라이언트에넘긴다")
		void search_userId_passedToClient() {
			ai(response(List.of()));
			PlaceSearchRequest request = request("카페");

			engine.search(SearchPurpose.SEARCH, request, "user-1");
			engine.search(SearchPurpose.SEARCH, request, null);

			verify(aiClient).search(SearchPurpose.SEARCH, request, "user-1");
			verify(aiClient).search(SearchPurpose.SEARCH, request, null);
		}

		@Test
		@DisplayName("자동완성과상세_어떤입력이든_AI를부르지않는다")
		void suggestAndDetail_anyInput_doNotCallAi() {
			when(keywordSearch.search("역삼", 0, 5)).thenReturn(List.of());
			engine.suggest("역삼");
			engine.findPlace(1L);
			verifyNoInteractions(aiClient);
		}
	}

	@Nested
	@DisplayName("AI 결과를 카드로")
	class AiCards {

		@Test
		@DisplayName("AI카드_순서와AI필드를그대로옮기고_장소와영업상태를붙인다")
		void aiCards_aiResponse_keepOrderAndFields() {
			Reason reason = new Reason("제목", List.of(new ReasonTag(EvidenceSource.REQUEST, "조용해요")), "인용", "앱 리뷰");
			ScoreItem scoreItem = new ScoreItem(EvidenceSource.PREFERENCE, "넓어요", true, 3);
			Map<String, Object> conditions = new HashMap<>();
			conditions.put("text", "t");
			conditions.put("station", null);
			ai(new AiSearchClient.Response(conditions, true, "바뀐 점", new EmptyReason("c", "s"),
					List.of(new AiSearchClient.Item(2L, 90, List.of("라벨"), List.of(reason), List.of(scoreItem)),
							item(1L)),
					List.of(), null, null, null));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.CLOSED), card(B, OpenStatus.BREAK)));

			PlaceSearchResult result = engine.search(SearchPurpose.SEARCH, request("카페"), null);

			PlaceSearchResponse response = result.response();
			assertThat(result.fallback()).isNull();
			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(2L, 1L);
			PlaceCard first = response.items().get(0);
			assertThat(first.place()).isEqualTo(B);
			assertThat(first.openStatus()).isEqualTo(OpenStatus.BREAK);
			assertThat(first.score()).isEqualTo(90);
			assertThat(first.labels()).containsExactly("라벨");
			assertThat(first.reasons()).containsExactly(reason);
			assertThat(first.scoreItems()).containsExactly(scoreItem);
			assertThat(first.caution()).isNull();
			assertThat(response.conditions()).isSameAs(conditions);
			assertThat(response.nearby()).isTrue();
			assertThat(response.changeSummary()).isEqualTo("바뀐 점");
			assertThat(response.emptyReason()).isEqualTo(new EmptyReason("c", "s"));
			assertThat(response.totalCount()).isEqualTo(2);
			assertThat(response.nextCursor()).isNull();
		}

		@Test
		@DisplayName("AI카드_AI가뺀값은_빈목록과없음이고conditions는빈객체nearby는false다")
		void aiCards_missingValues_defaults() {
			ai(new AiSearchClient.Response(null, null, null, null, List.of(item(1L)), null, null, null, null));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.OPEN)));

			PlaceSearchResult result = engine.search(SearchPurpose.SEARCH, request("카페"), null);

			PlaceCard card = result.response().items().getFirst();
			assertThat(card.score()).isNull();
			assertThat(card.labels()).isEmpty();
			assertThat(card.reasons()).isEmpty();
			assertThat(card.scoreItems()).isEmpty();
			assertThat(result.response().conditions()).isEmpty();
			assertThat(result.response().nearby()).isFalse();
			assertThat(result.response().changeSummary()).isNull();
			assertThat(result.response().emptyReason()).isNull();
			assertThat(result.fallback()).isNull();
		}

		@Test
		@DisplayName("AI카드_같은id가다시오면_처음카드만남는다")
		void aiCards_duplicateId_keepsFirst() {
			ai(response(List.of(new AiSearchClient.Item(1L, 90, null, null, null), item(2L),
					new AiSearchClient.Item(1L, 10, null, null, null))));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.OPEN), card(B, OpenStatus.OPEN)));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, request("카페"), null).response();

			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(1L, 2L);
			assertThat(response.items().getFirst().score()).isEqualTo(90);
			assertThat(response.totalCount()).isEqualTo(2);
			verify(catalog).cards(List.of(1L, 2L));
		}

		@Test
		@DisplayName("AI카드_카탈로그에없는id는_빼고채우지않으며중복을지운수를WARN으로남긴다")
		void aiCards_unknownIds_droppedAndCounted(CapturedOutput output) {
			ai(response(List.of(item(9L), item(1L), item(9L), item(8L))));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.OPEN)));

			PlaceSearchResult result = engine.search(SearchPurpose.SEARCH, request("카페"), null);

			assertThat(result.response().items()).extracting(card -> card.place().id()).containsExactly(1L);
			assertThat(result.response().totalCount()).isEqualTo(1);
			assertThat(result.fallback()).isNull();
			assertThat(output.getAll()).contains("WARN").contains("count=2");
		}

		@Test
		@DisplayName("AI카드_빈결과는_대체하지않고AI의emptyReason을준다")
		void aiCards_emptyItems_passThrough() {
			ai(new AiSearchClient.Response(Map.of(), false, null, new EmptyReason("c", "s"), List.of(), null, null,
					null, null));

			PlaceSearchResult result = engine.search(SearchPurpose.SEARCH, request("카페"), null);

			assertThat(result.fallback()).isNull();
			assertThat(result.response().items()).isEmpty();
			assertThat(result.response().emptyReason()).isEqualTo(new EmptyReason("c", "s"));
			verify(keywordSearch, never()).search(any(), anyInt(), anyInt());
		}

		@Test
		@DisplayName("AI카드_fallbacks가있으면_받은순서대로쉼표로잇는다")
		void aiCards_fallbacks_joinedInOrder() {
			ai(new AiSearchClient.Response(Map.of(), false, null, null, List.of(),
					List.of("PREVIOUS_INVALID", "TASTE_INVALID", "new_value"), null, null, null));

			assertThat(engine.search(SearchPurpose.SEARCH, request("카페"), null).fallback())
					.isEqualTo("PREVIOUS_INVALID,TASTE_INVALID,new_value");
		}

		@Test
		@DisplayName("AI카드_읽을수있는응답이면_interpretedBy와rankedBy와models를INFO로남기고문구는남기지않는다")
		void aiCards_readableResponse_logsModelsWithoutText(CapturedOutput output) {
			JsonMapper mapper = JsonMapper.builder().build();
			Reason reason = new Reason(SECRET, List.of(new ReasonTag(EvidenceSource.REQUEST, SECRET)), SECRET, SECRET);
			ai(new AiSearchClient.Response(Map.of("text", SECRET), false, SECRET, new EmptyReason(SECRET, SECRET),
					List.of(new AiSearchClient.Item(1L, 1, List.of(SECRET), List.of(reason), List.of())),
					List.of(), mapper.readTree("\"LLM\""), mapper.readTree("\"SIMILARITY\""),
					mapper.readTree("{\"llm\":\"gpt-x\"}")));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.OPEN)));

			engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest(SECRET, null, Map.of("text", SECRET), null, null), null);

			assertThat(output.getAll()).contains("INFO").contains("LLM").contains("SIMILARITY").contains("gpt-x")
					.doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI카드_카탈로그DB오류는_삼키지않는다")
		void aiCards_catalogError_propagates() {
			ai(response(List.of(item(1L))));
			when(catalog.cards(any())).thenThrow(new DataAccessResourceFailureException("db"));

			assertThatThrownBy(() -> engine.search(SearchPurpose.SEARCH, request("카페"), null))
					.isInstanceOf(DataAccessResourceFailureException.class);
		}
	}

	@Nested
	@DisplayName("대체 결과")
	class Fallback {

		@Test
		@DisplayName("대체_AI가빈값이면_AI_UNAVAILABLE이다")
		void fallback_aiEmpty_aiUnavailable() {
			when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			assertThat(engine.search(SearchPurpose.SEARCH, request("카페"), null).fallback()).isEqualTo("AI_UNAVAILABLE");
		}

		@Test
		@DisplayName("대체_AI클라이언트의예상못한예외는_대체로바꾼다")
		void fallback_clientThrows_fallsBack() {
			when(aiClient.search(any(), any(), any())).thenThrow(new IllegalStateException(SECRET));
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			assertThat(engine.search(SearchPurpose.SEARCH, request("카페"), null).fallback()).isEqualTo("AI_UNAVAILABLE");
		}

		@Test
		@DisplayName("대체_카드id가전부카탈로그에없으면_AI의fallbacks대신AI_UNAVAILABLE하나다")
		void fallback_allIdsUnknown_aiUnavailableOnly() {
			ai(new AiSearchClient.Response(Map.of("text", "t"), true, "s", null, List.of(item(9L)),
					List.of("TASTE_INVALID"), null, null, null));
			when(catalog.cards(List.of(9L))).thenReturn(List.of());
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			PlaceSearchResult result = engine.search(SearchPurpose.SEARCH, request("카페"), null);

			assertThat(result.fallback()).isEqualTo("AI_UNAVAILABLE");
			assertThat(result.response().nearby()).isFalse();
			assertThat(result.response().changeSummary()).isNull();
			assertThat(result.response().conditions()).isEmpty();
		}

		@ParameterizedTest
		@ValueSource(strings = {"근처 맛집", "  근처 맛집\t"})
		@DisplayName("대체_홈요청은_카탈로그전체를nearby로준다")
		void fallback_home_wholeCatalogNearby(String query) {
			unavailable();
			when(catalog.nearbyCandidates()).thenReturn(List.of(card(A, OpenStatus.OPEN), card(B, OpenStatus.OPEN)));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest(query, null, Map.of(), null, null), null)
					.response();

			assertThat(response.nearby()).isTrue();
			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(1L, 2L);
			assertThat(response.totalCount()).isEqualTo(2);
			verify(keywordSearch, never()).search(any(), anyInt(), anyInt());
		}

		@ParameterizedTest
		@ValueSource(strings = {"근처 맛집집", "근처  맛집", "강남역 근처 맛집"})
		@DisplayName("대체_홈문장이아니면_키워드검색이다")
		void fallback_notHomeQuery_keyword(String query) {
			unavailable();
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			assertThat(engine.search(SearchPurpose.SEARCH, request(query), null).response().nearby()).isFalse();
			verify(catalog, never()).nearbyCandidates();
		}

		@Test
		@DisplayName("대체_이전조건이있으면_홈요청이아니고conditions로돌려준다")
		void fallback_homeWithPrevious_keywordAndEchoesConditions() {
			unavailable();
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, 
					new PlaceSearchRequest("근처 맛집", null, Map.of("text", "이전"), null, null), null).response();

			assertThat(response.nearby()).isFalse();
			assertThat(response.conditions()).containsEntry("text", "이전");
		}

		@Test
		@DisplayName("대체_홈요청도지도영역이있으면_영역안만남는다")
		void fallback_homeWithBounds_filtered() {
			unavailable();
			when(catalog.nearbyCandidates()).thenReturn(List.of(card(at(1L, 37.50, 127.00), OpenStatus.OPEN),
					card(at(2L, 37.60, 127.00), OpenStatus.OPEN)));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest("근처 맛집", null, null,
					new MapBounds(37.40, null, 37.55, null), null), null).response();

			assertThat(response.nearby()).isTrue();
			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(1L);
		}

		@Test
		@DisplayName("대체_지도영역은경계를포함하고_빈값은그쪽을제한하지않는다")
		void fallback_bounds_inclusiveAndOpenSides() {
			unavailable();
			when(keywordSearch.search("카페", 0, Integer.MAX_VALUE)).thenReturn(List.of(
					hit(at(1L, 37.40, 127.00)), hit(at(2L, 37.50, 127.10)), hit(at(3L, 37.39, 127.00)),
					hit(at(4L, 37.45, 127.11)), hit(at(5L, 80.0, -50.0))));
			when(catalog.cards(any())).thenAnswer(invocation -> cardsFor(invocation.getArgument(0)));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest("카페", null, null,
					new MapBounds(37.40, null, 37.50, 127.10), null), null).response();

			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(1L, 2L);
		}

		@Test
		@DisplayName("대체_키워드결과는_전체를영역으로거른뒤앞20곳을id로읽고순위순이며없는장소는빠진다")
		void fallback_keyword_filterThenTwentyThenRead() {
			unavailable();
			List<PlaceKeywordHit> hits = new ArrayList<>();
			hits.add(hit(at(100L, 10.0, 10.0)));
			for (long id = 30; id >= 1; id--) {
				hits.add(hit(at(id, 37.5, 127.0)));
			}
			when(keywordSearch.search("카페", 0, Integer.MAX_VALUE)).thenReturn(hits);
			when(catalog.cards(any())).thenAnswer(invocation -> cardsFor(invocation.<List<Long>>getArgument(0).stream()
					.filter(id -> id != 25L).toList()));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest("카페", null, null,
					new MapBounds(37.0, 126.0, 38.0, 128.0), null), null).response();

			List<Long> expected = new ArrayList<>();
			for (long id = 30; id >= 11; id--) {
				if (id != 25L) {
					expected.add(id);
				}
			}
			verify(catalog).cards(argThat(ids -> ids.size() == 20 && !ids.contains(100L) && ids.contains(11L)));
			assertThat(response.items()).extracting(card -> card.place().id()).containsExactlyElementsOf(expected);
			assertThat(response.totalCount()).isEqualTo(19);
		}

		@Test
		@DisplayName("대체_카드는점수없이빈목록이고_conditions는받은값이며커서와요약이없다")
		void fallback_keywordHit_cardWithoutScore() {
			unavailable();
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of(hit(A)));
			when(catalog.cards(any())).thenReturn(List.of(card(A, OpenStatus.CLOSING_SOON)));

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, 
					new PlaceSearchRequest("하노이", null, Map.of("text", "이전"), null, null), null).response();

			PlaceCard card = response.items().getFirst();
			assertThat(card.place()).isEqualTo(A);
			assertThat(card.openStatus()).isEqualTo(OpenStatus.CLOSING_SOON);
			assertThat(card.score()).isNull();
			assertThat(card.labels()).isEmpty();
			assertThat(card.reasons()).isEmpty();
			assertThat(card.scoreItems()).isEmpty();
			assertThat(response.conditions()).containsEntry("text", "이전");
			assertThat(response.nextCursor()).isNull();
			assertThat(response.changeSummary()).isNull();
			assertThat(response.emptyReason()).isNull();
			assertThat(response.totalCount()).isEqualTo(1);
		}

		@Test
		@DisplayName("대체_남은카드가없으면_빈목록과정해진emptyReason이다")
		void fallback_empty_emptyReason() {
			unavailable();
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			PlaceSearchResponse response = engine.search(SearchPurpose.SEARCH, request("조용한 데이트 장소"), null).response();

			assertThat(response.items()).isEmpty();
			assertThat(response.totalCount()).isZero();
			assertThat(response.conditions()).isEmpty();
			assertThat(response.emptyReason()).isEqualTo(new EmptyReason(
					"지금은 가게 이름, 메뉴, 업종, 역 이름으로만 찾을 수 있어요", "가게 이름이나 메뉴 이름으로 다시 검색해 보세요"));
		}

		@Test
		@DisplayName("대체_키워드검색의503예외와DB오류는_삼키지않는다")
		void fallback_keywordAndCatalogErrors_propagate() {
			unavailable();
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenThrow(new PlaceSearchUnavailableException());
			assertThatThrownBy(() -> engine.search(SearchPurpose.SEARCH, request("카페"), null))
					.isInstanceOf(PlaceSearchUnavailableException.class);

			when(catalog.nearbyCandidates()).thenThrow(new DataAccessResourceFailureException("db"));
			assertThatThrownBy(() -> engine.search(SearchPurpose.SEARCH, request("근처 맛집"), null))
					.isInstanceOf(DataAccessResourceFailureException.class);
		}

		@Test
		@DisplayName("대체_입력에표식이있어도_로그에검색문장과이전조건이없다")
		void fallback_secretInput_notLogged(CapturedOutput output) {
			when(aiClient.search(any(), any(), any())).thenThrow(new IllegalStateException(SECRET));
			when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

			engine.search(SearchPurpose.SEARCH, new PlaceSearchRequest(SECRET, null, Map.of("text", SECRET), null, null), null);

			assertThat(output.getAll()).doesNotContain(SECRET);
		}

		void unavailable() {
			when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		}
	}

	private static final String SECRET = "비밀표식9c41";

	private void ai(AiSearchClient.Response response) {
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.of(response));
	}

	private static AiSearchClient.Response response(List<AiSearchClient.Item> items) {
		return new AiSearchClient.Response(Map.of(), false, null, null, items, List.of(), null, null, null);
	}

	private static AiSearchClient.Item item(long placeId) {
		return new AiSearchClient.Item(placeId, null, null, null, null);
	}

	private static PlaceSearchRequest request(String query) {
		return new PlaceSearchRequest(query, null, null, null, null);
	}

	private static PlaceCard card(PlaceSummary place, OpenStatus status) {
		return new PlaceCard(place, null, List.of(), null, status, List.of(), List.of());
	}

	private static PlaceSummary at(long id, double lat, double lng) {
		return new PlaceSummary(id, "장소" + id, CategoryGroup.CAFE, Station.GANGNAM, lat, lng, null);
	}

	private static PlaceKeywordHit hit(PlaceSummary place) {
		return new PlaceKeywordHit(place, null, false);
	}

	/** 카탈로그처럼 place_id 오름차순으로 돌려준다 */
	private static List<PlaceCard> cardsFor(java.util.Collection<Long> ids) {
		return ids.stream().sorted().map(id -> card(at(id, 37.5, 127.0), OpenStatus.OPEN)).toList();
	}

}
