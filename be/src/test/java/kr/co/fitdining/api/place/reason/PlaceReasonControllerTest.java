package kr.co.fitdining.api.place.reason;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse.ReasonView;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.support.SessionTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 상세 추천 이유 API의 요청 검증, 비회원 접근, 오류 응답을 확인한다. */
@TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = PlaceReasonController.class)
class PlaceReasonControllerTest {

	static final String QUIET = """
			{"source":"REQUEST","code":"QUIET","label":"조용해요","value":0.95,"fromReviews":true,
			 "fallbackTitle":"카페 중 손꼽히게 조용해요"}""";

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	PlaceReasonService service;

	@MockitoBean
	AuthUseCases auth;

	@BeforeEach
	void setUp() {
		when(service.reasons(anyLong(), any())).thenReturn(new PlaceReasonsResponse(
				List.of(new ReasonView(EvidenceSource.REQUEST, "조용해요", "차분해요", List.of(), null))));
	}

	private static MockHttpServletRequestBuilder reasons(Object placeId, String body) {
		return post("/api/v1/places/{placeId}/reasons", placeId).with(SessionTestSupport.csrf())
				.contentType(MediaType.APPLICATION_JSON).content(body);
	}

	@Test
	@DisplayName("추천이유_비회원도_세션없이받고페르소나요약이없으면필드를뺀다")
	void reasons_guest_ok() throws Exception {
		mockMvc.perform(reasons(7, "{\"request\":\"조용한 카페\",\"reasons\":[" + QUIET + "]}"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.reasons[0].title").value("차분해요"))
				.andExpect(jsonPath("$.reasons[0].reviews").isEmpty())
				.andExpect(jsonPath("$.reasons[0].personaSummary").doesNotExist());
		verify(service).reasons(eq(7L), any());
	}

	@Test
	@DisplayName("추천이유_CSRF토큰이없으면_403이다")
	void reasons_withoutCsrf_forbidden() throws Exception {
		mockMvc.perform(post("/api/v1/places/7/reasons").contentType(MediaType.APPLICATION_JSON)
				.content("{\"reasons\":[" + QUIET + "]}")).andExpect(status().isForbidden());
		verify(service, never()).reasons(anyLong(), any());
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"{\"reasons\":[]}",
			"{}",
			"{\"reasons\":[null]}",
			"{\"reasons\":[" + "QUIET_X" + "]}",
			"{\"reasons\":[{\"source\":\"REQUEST\",\"code\":\"quiet\",\"label\":\"조용해요\",\"value\":0.9,"
					+ "\"fromReviews\":true,\"fallbackTitle\":\"t\"}]}",
			"{\"reasons\":[{\"source\":\"REQUEST\",\"code\":\"QUIET\",\"label\":\"조용해요\",\"value\":1.2,"
					+ "\"fromReviews\":true,\"fallbackTitle\":\"t\"}]}",
			"{\"reasons\":[{\"source\":\"OTHER\",\"code\":\"QUIET\",\"label\":\"조용해요\",\"value\":0.9,"
					+ "\"fromReviews\":true,\"fallbackTitle\":\"t\"}]}",
			"{\"reasons\":[{\"source\":\"REQUEST\",\"code\":\"QUIET\",\"label\":\"조용해요\",\"value\":0.9,"
					+ "\"fallbackTitle\":\"t\"}]}",
			"{\"turnId\":\"entry-1\",\"reasons\":[{\"source\":\"REQUEST\",\"code\":\"QUIET\",\"label\":\"조용해요\","
					+ "\"value\":0.9,\"fromReviews\":true,\"fallbackTitle\":\"t\"}]}"
	})
	@DisplayName("추천이유_이유가없거나많거나항목형식이틀리거나모르는속성이있으면_400이다")
	void reasons_invalidBody_badRequest(String body) throws Exception {
		mockMvc.perform(reasons(7, body.replace("QUIET_X", QUIET + "," + QUIET + "," + QUIET + "," + QUIET + "," + QUIET)))
				.andExpect(status().isBadRequest());
		verify(service, never()).reasons(anyLong(), any());
	}

	@Test
	@DisplayName("추천이유_요청문장이200자를넘으면_400이다")
	void reasons_longSentence_badRequest() throws Exception {
		mockMvc.perform(reasons(7, "{\"request\":\"" + "가".repeat(201) + "\",\"reasons\":[" + QUIET + "]}"))
				.andExpect(status().isBadRequest());
	}

	@Test
	@DisplayName("추천이유_장소가없으면_404다")
	void reasons_unknownPlace_notFound() throws Exception {
		when(service.reasons(eq(8L), any())).thenThrow(new PlaceNotFoundException());

		mockMvc.perform(reasons(8, "{\"reasons\":[" + QUIET + "]}")).andExpect(status().isNotFound());
	}

}
