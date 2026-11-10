package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.auth.ports.AuthUseCases;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.engine.AiSearchClient;
import kr.co.fitdining.api.place.engine.CatalogPlaceSearchEngine;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Mock을 끄면(DB 모드) 카탈로그, 키워드 검색, AI 클라이언트로 응답한다. 셋은 가짜로 두고 컨트롤러부터 엔진까지의 연결을
 * HTTP 수준에서 본다.
 */
@ExtendWith(OutputCaptureExtension.class)
@org.springframework.test.context.TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=false")
@Import({PlaceService.class, CatalogPlaceSearchEngine.class})
class PlaceControllerMockDisabledTest {

	private static final PlaceSummary PLACE = new PlaceSummary(7L, "하노이 쌀국수 역삼점", CategoryGroup.RESTAURANT,
			Station.YEOKSAM, 37.5, 127.03, null);

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	AuthUseCases auth;

	@MockitoBean
	PlaceCatalog catalog;

	@MockitoBean
	PlaceKeywordSearch keywordSearch;

	@MockitoBean
	AiSearchClient aiClient;

	@Test
	@DisplayName("자동완성_이름접두히트가없으면_추천받기가맨위다")
	void suggest_noPrefixHit_actionFirst() throws Exception {
		when(keywordSearch.search("역삼", 0, 5)).thenReturn(List.of(new PlaceKeywordHit(PLACE, "양지 쌀국수", false)));

		mockMvc.perform(get("/api/v1/places/suggest").param("q", "역삼"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0].type").value("ACTION"))
				.andExpect(jsonPath("$[0].label").value("이 조건으로 추천받기"))
				.andExpect(jsonPath("$[1].type").value("PLACE"))
				.andExpect(jsonPath("$[1].place.id").value(7))
				.andExpect(jsonPath("$[1].matchedMenu").value("양지 쌀국수"));
	}

	@Test
	@DisplayName("자동완성_이름접두히트가있으면_추천받기가맨뒤다")
	void suggest_prefixHit_actionLast() throws Exception {
		when(keywordSearch.search("하노이", 0, 5)).thenReturn(List.of(new PlaceKeywordHit(PLACE, null, true)));

		mockMvc.perform(get("/api/v1/places/suggest").param("q", "하노이"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0].type").value("PLACE"))
				.andExpect(jsonPath("$[1].type").value("ACTION"));
	}

	@Test
	@DisplayName("자동완성_공백뿐인입력은_형식검증이먼저라400이다")
	void suggest_blankQ_returnsBadRequest() throws Exception {
		mockMvc.perform(get("/api/v1/places/suggest").param("q", " "))
				.andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("자동완성_키워드검색을못쓰면_503이고입력은로그에없다")
	void suggest_keywordSearchUnavailable_returns503WithoutLoggingQuery(CapturedOutput output) throws Exception {
		when(keywordSearch.search(anyString(), anyInt(), anyInt())).thenThrow(new PlaceSearchUnavailableException());

		expectUnavailable(get("/api/v1/places/suggest").param("q", "비밀검색어"));

		assertThat(output).doesNotContain("비밀검색어");
	}

	@Test
	@DisplayName("자동완성_정상으로응답해도_입력은로그에없다")
	void suggest_success_doesNotLogQuery(CapturedOutput output) throws Exception {
		when(keywordSearch.search(anyString(), anyInt(), anyInt())).thenReturn(List.of());

		mockMvc.perform(get("/api/v1/places/suggest").param("q", "비밀검색어")).andExpect(status().isOk());

		assertThat(output).doesNotContain("비밀검색어");
	}

	@Test
	@DisplayName("장소상세_카탈로그에있으면_200이다")
	void getPlace_found_returnsDetail() throws Exception {
		when(catalog.findPlace(7L)).thenReturn(Optional.of(detail()));

		mockMvc.perform(get("/api/v1/places/{id}", 7))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.place.id").value(7))
				.andExpect(jsonPath("$.address").value("주소"));
	}

	@Test
	@DisplayName("장소상세_카탈로그에없으면_404다")
	void getPlace_missing_returnsNotFound() throws Exception {
		when(catalog.findPlace(9L)).thenReturn(Optional.empty());

		mockMvc.perform(get("/api/v1/places/{id}", 9)).andExpect(status().isNotFound());
	}

	@Test
	@DisplayName("추천검색_AI결과면_카드와AI의fallbacks헤더로200이다")
	void search_aiResult_returnsCardsWithFallbackHeader() throws Exception {
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.of(new AiSearchClient.Response(Map.of("text", "t"),
				false, null, null, List.of(new AiSearchClient.Item(7L, 88, List.of("조용해요"), null, null)),
				List.of("TASTE_INVALID"), null, null, null)));
		when(catalog.cards(any())).thenReturn(List.of(card()));

		mockMvc.perform(search("{\"query\":\"조용한 데이트 장소\"}"))
				.andExpect(status().isOk())
				.andExpect(header().string("X-Fallback", "TASTE_INVALID"))
				.andExpect(jsonPath("$.items[0].place.id").value(7))
				.andExpect(jsonPath("$.items[0].score").value(88))
				.andExpect(jsonPath("$.items[0].labels[0]").value("조용해요"))
				.andExpect(jsonPath("$.items[0].openStatus").value("OPEN"))
				.andExpect(jsonPath("$.conditions.text").value("t"))
				.andExpect(jsonPath("$.totalCount").value(1))
				.andExpect(jsonPath("$.nextCursor").doesNotExist());
	}

	@Test
	@DisplayName("추천검색_AI를쓸수없으면_대체결과와AI_UNAVAILABLE헤더로200이다")
	void search_aiUnavailable_returnsFallbackWithHeader() throws Exception {
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of(new PlaceKeywordHit(PLACE, null, true)));
		when(catalog.cards(any())).thenReturn(List.of(card()));

		mockMvc.perform(search("{\"query\":\"카페\"}"))
				.andExpect(status().isOk())
				.andExpect(header().string("X-Fallback", "AI_UNAVAILABLE"))
				.andExpect(jsonPath("$.nearby").value(false))
				.andExpect(jsonPath("$.items[0].place.id").value(7))
				.andExpect(jsonPath("$.items[0].score").doesNotExist())
				.andExpect(jsonPath("$.items[0].labels").isEmpty());
	}

	@ParameterizedTest
	@ValueSource(strings = {"\"abc\"", "\"\""})
	@DisplayName("추천검색_cursor가있으면_AI를부르지않고400이다")
	void search_withCursor_returnsBadRequestWithoutAi(String cursor) throws Exception {
		mockMvc.perform(search("{\"query\":\"근처 맛집\",\"cursor\":" + cursor + "}"))
				.andExpect(status().isBadRequest())
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		verifyNoInteractions(aiClient);
	}

	@Test
	@DisplayName("추천검색_cursor가null이면_커서없음이다")
	void search_nullCursor_searches() throws Exception {
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

		mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":null}")).andExpect(status().isOk());
	}

	@Test
	@DisplayName("추천검색_cursor와무효한토큰이함께오면_401이먼저이고AI를부르지않는다")
	void search_cursorAndInvalidToken_unauthorizedFirst() throws Exception {
		when(auth.authenticate("bad")).thenThrow(new AuthFailure("x"));

		mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"abc\"}").header("Authorization", "Bearer bad"))
				.andExpect(status().isUnauthorized());
		mockMvc.perform(search("{\"query\":\"카페\"}").header("Authorization", "Basic x"))
				.andExpect(status().isUnauthorized());
		verifyNoInteractions(aiClient);
	}

	@Test
	@DisplayName("추천검색_유효한토큰이면_토큰의사용자id로AI를부른다")
	void search_validToken_callsAiWithTokenUserId() throws Exception {
		when(auth.authenticate("token")).thenReturn(new AuthUseCases.Identity("user-1", "닉", "s", 0, 0));
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of());

		mockMvc.perform(search("{\"query\":\"카페\"}").header("Authorization", "Bearer token"))
				.andExpect(status().isOk());

		verify(aiClient).search(any(), any(), eq("user-1"));
	}

	@Test
	@DisplayName("추천검색_카탈로그DB오류는_대체하지않고503이다")
	void search_catalogError_returnsServiceUnavailable() throws Exception {
		when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of(new PlaceKeywordHit(PLACE, null, true)));
		when(catalog.cards(any())).thenThrow(new DataAccessResourceFailureException("db"));

		expectUnavailable(search("{\"query\":\"카페\"}"));
	}

	@Test
	@DisplayName("suggestAndDetail_badAuthorization_rejected")
    void suggestAndDetail_badAuthorization_rejected() throws Exception {
        when(auth.authenticate("bad")).thenThrow(new kr.co.fitdining.api.auth.domain.AuthFailure("invalid"));
        mockMvc.perform(get("/api/v1/places/suggest").param("q", "cafe").header("Authorization", "Bearer bad"))
            .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/places/{id}", 7).header("Authorization", "garbage"))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(aiClient, catalog, keywordSearch);
    }

	private static final String SECRET = "비밀표식9c41";

	static Stream<Arguments> requestsWithSecret() {
		String body = "{\"query\":\"" + SECRET + "\",\"previousConditions\":{\"text\":\"" + SECRET + "\"},"
				+ "\"preferences\":{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"" + SECRET + "\"}]}}";
		return Stream.of(
				Arguments.of("AI 성공", search(body), 200),
				Arguments.of("대체", search(body), 200),
				Arguments.of("cursor 400", search(body.substring(0, body.length() - 1) + ",\"cursor\":\"" + SECRET + "\"}"), 400),
				Arguments.of("401", search(body).header("Authorization", "Bearer " + SECRET), 401),
				Arguments.of("503", search(body), 503));
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("requestsWithSecret")
	@DisplayName("추천검색_어떤결과든_로그에입력값과AI문구가없다")
	void search_anyOutcome_doesNotLogInput(String scenario, MockHttpServletRequestBuilder request, int status,
			CapturedOutput output) throws Exception {
		when(auth.authenticate(any())).thenThrow(new AuthFailure(SECRET));
		when(keywordSearch.search(any(), anyInt(), anyInt())).thenReturn(List.of(new PlaceKeywordHit(PLACE, null, true)));
		when(catalog.cards(any())).thenReturn(List.of(card()));
		switch (scenario) {
			case "AI 성공" -> when(aiClient.search(any(), any(), any())).thenReturn(Optional.of(new AiSearchClient.Response(
					Map.of("text", SECRET), false, SECRET, null, List.of(new AiSearchClient.Item(7L, 1, List.of(SECRET),
							List.of(new Reason(SECRET, List.of(), SECRET, SECRET)), null)), List.of(), null, null, null)));
			case "503" -> {
				when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
				when(catalog.cards(any())).thenThrow(new DataAccessResourceFailureException("db"));
			}
			default -> when(aiClient.search(any(), any(), any())).thenReturn(Optional.empty());
		}

		mockMvc.perform(request).andExpect(status().is(status));

		assertThat(output.getAll()).doesNotContain(SECRET);
	}

	private static PlaceCard card() {
		return new PlaceCard(PLACE, null, List.of(), null, OpenStatus.OPEN, List.of(), List.of());
	}

	private static MockHttpServletRequestBuilder search(String body) {
		return post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON).content(body);
	}

	private static PlaceDetailResponse detail() {
		return new PlaceDetailResponse(PLACE, "주소", List.of(), List.of(), null, null, OpenStatus.OPEN, List.of(), null,
				List.of(), List.of(), List.of(), null, null, null, false, null, null, List.of(), null, List.of(),
				List.of(), List.of());
	}

	private void expectUnavailable(MockHttpServletRequestBuilder request) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().isServiceUnavailable())
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(503))
				.andExpect(jsonPath("$.detail").isString());
	}

}
