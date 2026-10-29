package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.engine.CatalogPlaceSearchEngine;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.place.keyword.PlaceKeywordHit;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Mock을 끄면(DB 모드) 카탈로그와 키워드 검색 포트로 응답한다. 포트는 가짜로 두고 컨트롤러부터 엔진까지의 연결을 본다. */
@ExtendWith(OutputCaptureExtension.class)
@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=false")
@Import({PlaceService.class, CatalogPlaceSearchEngine.class})
class PlaceControllerMockDisabledTest {

	private static final PlaceSummary PLACE = new PlaceSummary(7L, "하노이 쌀국수 역삼점", CategoryGroup.RESTAURANT,
			Station.YEOKSAM, 37.5, 127.03, null);

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	PlaceCatalog catalog;

	@MockitoBean
	PlaceKeywordSearch keywordSearch;

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
	@DisplayName("추천검색_근처요청이면_점수없는카드로200이다")
	void search_nearby_returnsCardsWithoutScore() throws Exception {
		when(catalog.nearbyCandidates()).thenReturn(
				List.of(new PlaceCard(PLACE, null, List.of(), null, OpenStatus.OPEN, List.of(), List.of())));

		mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
						.content("{\"query\":\"근처 맛집\"}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.nearby").value(true))
				.andExpect(jsonPath("$.totalCount").value(1))
				.andExpect(jsonPath("$.items[0].place.id").value(7))
				.andExpect(jsonPath("$.items[0].score").doesNotExist())
				.andExpect(jsonPath("$.items[0].labels").isEmpty())
				.andExpect(jsonPath("$.nextCursor").doesNotExist());
	}

	@Test
	@DisplayName("추천검색_근처가없는자연어요청은_AI엔진전까지503이다")
	void search_naturalLanguage_returnsServiceUnavailable() throws Exception {
		expectUnavailable(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
				.content("{\"query\":\"조용한 데이트 장소\"}"));
	}

	@Test
	@DisplayName("추천검색_커서가있는요청은_503이다")
	void search_withCursor_returnsServiceUnavailable() throws Exception {
		expectUnavailable(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
				.content("{\"query\":\"근처 맛집\",\"cursor\":\"abc\"}"));
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
