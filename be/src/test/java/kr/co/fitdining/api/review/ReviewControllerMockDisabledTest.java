package kr.co.fitdining.api.review;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.review.store.InMemoryReviewStore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 개발자의 be/.env가 메모리 저장소를 켜 두어도 속성을 명시적으로 끈다. */
@WebMvcTest(controllers = ReviewController.class, properties = "review.mock.enabled=false")
@Import({ReviewService.class, InMemoryReviewStore.class})
class ReviewControllerMockDisabledTest {

	@Autowired
	MockMvc mockMvc;

	@Test
	@DisplayName("목록_저장소가꺼져있고다른구현도없으면_503이다")
	void list_noStore_returnsServiceUnavailable() throws Exception {
		expectUnavailable(get("/api/v1/places/{placeId}/reviews", 1));
	}

	@Test
	@DisplayName("등록_저장소가꺼져있고다른구현도없으면_503이다")
	void create_noStore_returnsServiceUnavailable() throws Exception {
		expectUnavailable(post("/api/v1/places/{placeId}/reviews", 1).contentType(MediaType.APPLICATION_JSON)
				.content("{\"description\":\"좋았어요\"}"));
	}

	@Test
	@DisplayName("목록_저장소가없어도_형식검증이먼저라400이다")
	void list_noStoreAndInvalidPlaceId_returnsBadRequest() throws Exception {
		mockMvc.perform(get("/api/v1/places/{placeId}/reviews", 0))
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
