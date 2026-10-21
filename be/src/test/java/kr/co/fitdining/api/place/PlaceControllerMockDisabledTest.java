package kr.co.fitdining.api.place;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.place.engine.MockPlaceSearchEngine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 개발자의 be/.env가 Mock을 켜 두어도 속성을 명시적으로 끈다. */
@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=false")
@Import({PlaceService.class, MockPlaceSearchEngine.class})
class PlaceControllerMockDisabledTest {

	@Autowired
	MockMvc mockMvc;

	@Test
	@DisplayName("자동완성_Mock이꺼져있고다른구현도없으면_503이다")
	void suggest_noEngine_returnsServiceUnavailable() throws Exception {
		expectUnavailable(get("/api/v1/places/suggest").param("q", "역삼"));
	}

	@Test
	@DisplayName("추천검색_Mock이꺼져있고다른구현도없으면_503이다")
	void search_noEngine_returnsServiceUnavailable() throws Exception {
		expectUnavailable(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
				.content("{\"query\":\"카페\"}"));
	}

	@Test
	@DisplayName("장소상세_Mock이꺼져있고다른구현도없으면_503이다")
	void getPlace_noEngine_returnsServiceUnavailable() throws Exception {
		expectUnavailable(get("/api/v1/places/{id}", 1));
	}

	@Test
	@DisplayName("자동완성_엔진이없어도_형식검증이먼저라400이다")
	void suggest_noEngineAndBlankQ_returnsBadRequest() throws Exception {
		mockMvc.perform(get("/api/v1/places/suggest").param("q", " "))
				.andExpect(status().isBadRequest());
	}

	private void expectUnavailable(MockHttpServletRequestBuilder request) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().isServiceUnavailable())
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(503))
				.andExpect(jsonPath("$.detail").isString());
	}

}
