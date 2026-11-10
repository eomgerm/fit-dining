package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.place.engine.MockPlaceSearchEngine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 목적별 API {@code POST /places/nearby}, {@code POST /places/search/region}의 요청 검증과 Mock 모드 응답을 HTTP 수준에서
 * 본다(place-ai-search AC-22, AC-29 ~ AC-31, AC-33, AC-20).
 */
@TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=true")
@Import({PlaceService.class, MockPlaceSearchEngine.class, PlaceAreaSearchControllerTest.FixedClockConfig.class})
class PlaceAreaSearchControllerTest {

	@TestConfiguration
	static class FixedClockConfig {
		@Bean
		Clock clock() {
			return Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneId.of("Asia/Seoul"));
		}
	}

	/** mock 장소 36곳을 모두 담는 영역 */
	static final String ALL = "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.06}";
	/** 경도 127.04 서쪽. mock 장소 21곳 */
	static final String WEST = "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.04}";

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	AuthUseCases auth;

	static MockHttpServletRequestBuilder nearby(String body) {
		return post("/api/v1/places/nearby").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	static MockHttpServletRequestBuilder region(String body) {
		return post("/api/v1/places/search/region").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	static MockHttpServletRequestBuilder search(String body) {
		return post("/api/v1/places/search").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	/** 지도 영역 검증에 걸리는 값(AC-29) */
	static Stream<Arguments> invalidBounds() {
		return Stream.of(
				Arguments.of("영역 없음", null),
				Arguments.of("영역 null", "null"),
				Arguments.of("한 값 없음", "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51}"),
				Arguments.of("한 값 null", "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":null}"),
				Arguments.of("무한대", "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":1e400,\"neLng\":127.06}"),
				Arguments.of("위도 범위 밖", "{\"swLat\":-90.5,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.06}"),
				Arguments.of("위도 상한 밖", "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":90.5,\"neLng\":127.06}"),
				Arguments.of("경도 하한 밖", "{\"swLat\":37.49,\"swLng\":-180.5,\"neLat\":37.51,\"neLng\":127.06}"),
				Arguments.of("경도 범위 밖", "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":180.5}"),
				Arguments.of("위도 같음", "{\"swLat\":37.5,\"swLng\":127.02,\"neLat\":37.5,\"neLng\":127.06}"),
				Arguments.of("경도 같음", "{\"swLat\":37.49,\"swLng\":127.04,\"neLat\":37.51,\"neLng\":127.04}"),
				Arguments.of("경도 뒤집힘", "{\"swLat\":37.49,\"swLng\":127.06,\"neLat\":37.51,\"neLng\":127.02}"),
				Arguments.of("문자열 좌표", "{\"swLat\":\"북쪽\",\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.06}"));
	}

	static String nearbyBody(String bounds) {
		return bounds == null ? "{}" : "{\"mapBounds\":" + bounds + "}";
	}

	static String regionBody(String bounds) {
		return bounds == null ? "{\"query\":\"파스타\"}" : "{\"query\":\"파스타\",\"mapBounds\":" + bounds + "}";
	}

	@Nested
	@DisplayName("지도 영역 검증")
	class Bounds {

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.place.PlaceAreaSearchControllerTest#invalidBounds")
		@DisplayName("주변_지도영역이잘못되면_400이다")
		void nearby_invalidBounds_badRequest(String scenario, String bounds) throws Exception {
			mockMvc.perform(nearby(nearbyBody(bounds)))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.place.PlaceAreaSearchControllerTest#invalidBounds")
		@DisplayName("이지역에서검색_지도영역이잘못되면_400이다")
		void region_invalidBounds_badRequest(String scenario, String bounds) throws Exception {
			mockMvc.perform(region(regionBody(bounds)))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("지도영역_범위경계값은_받는다")
		void bounds_rangeEdges_accepted() throws Exception {
			String edges = "{\"swLat\":-90,\"swLng\":-180,\"neLat\":90,\"neLng\":180}";
			mockMvc.perform(nearby(nearbyBody(edges))).andExpect(status().isOk());
			mockMvc.perform(region(regionBody(edges))).andExpect(status().isOk());
		}

		@Test
		@DisplayName("추천검색_지도영역은_범위밖이거나뒤집혀도검증하지않는다")
		void search_bounds_notValidated() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"mapBounds\":{\"swLat\":95,\"neLng\":-200}}"))
					.andExpect(status().isOk());
			mockMvc.perform(search("{\"query\":\"카페\",\"mapBounds\":{\"swLat\":37.6,\"swLng\":127.1,"
					+ "\"neLat\":37.5,\"neLng\":127.0}}")).andExpect(status().isOk());
		}
	}

	@Nested
	@DisplayName("요청 속성")
	class Body {

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"mapBounds\":" + ALL + ",\"query\":\"근처 맛집\"}",
				"{\"mapBounds\":" + ALL + ",\"userId\":\"someone\"}",
				"{\"mapBounds\":" + ALL + ",\"cursor\":\"MjA\"}",
				"{\"mapBounds\":" + ALL + ",\"preferences\":[\"QUIET\"]}",
				"{\"mapBounds\":" + ALL + ",\"preferences\":{\"mood\":\"LOUD\"}}",
				"{\"mapBounds\":{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.06,\"lat\":37.5}}"})
		@DisplayName("주변_정의되지않은속성이나잘못된취향이면_400이다")
		void nearby_unknownOrInvalid_badRequest(String body) throws Exception {
			mockMvc.perform(nearby(body)).andExpect(status().isBadRequest());
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"mapBounds\":" + ALL + "}",
				"{\"query\":\"   \",\"mapBounds\":" + ALL + "}",
				"{\"query\":\"파스타\",\"mapBounds\":" + ALL + ",\"previousConditions\":{}}",
				"{\"query\":\"파스타\",\"mapBounds\":" + ALL + ",\"userId\":\"someone\"}",
				"{\"query\":\"파스타\",\"mapBounds\":" + ALL + ",\"conditions\":[1]}",
				"{\"query\":\"파스타\",\"mapBounds\":" + ALL + ",\"preferences\":[\"QUIET\"]}"})
		@DisplayName("이지역에서검색_문장이없거나정의되지않은속성이면_400이다")
		void region_invalidBody_badRequest(String body) throws Exception {
			mockMvc.perform(region(body)).andExpect(status().isBadRequest());
		}

		@Test
		@DisplayName("이지역에서검색_문장이200자를넘으면_400이다")
		void region_longQuery_badRequest() throws Exception {
			mockMvc.perform(region("{\"query\":\"" + "가".repeat(201) + "\",\"mapBounds\":" + ALL + "}"))
					.andExpect(status().isBadRequest());
			mockMvc.perform(region("{\"query\":\"" + "가".repeat(200) + "\",\"mapBounds\":" + ALL + "}"))
					.andExpect(status().isOk());
		}

		@Test
		@DisplayName("이지역에서검색_conditions가null이면_없는것과같다")
		void region_nullConditions_empty() throws Exception {
			mockMvc.perform(region("{\"query\":\"파스타\",\"conditions\":null,\"mapBounds\":" + ALL + "}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.conditions").isMap())
					.andExpect(jsonPath("$.conditions").isEmpty());
		}

		@Test
		@DisplayName("주변과이지역에서검색_새모양취향을받는다")
		void areaRequests_preferences_accepted() throws Exception {
			String preferences = "\"preferences\":{\"mood\":\"QUIET\",\"purposes\":[\"DATE\"]}";
			mockMvc.perform(nearby("{\"mapBounds\":" + ALL + "," + preferences + "}")).andExpect(status().isOk());
			mockMvc.perform(region("{\"query\":\"파스타\",\"mapBounds\":" + ALL + "," + preferences + "}"))
					.andExpect(status().isOk());
		}
	}

	@Nested
	@DisplayName("인증")
	class Auth {

		@Test
		@DisplayName("주변과이지역에서검색_헤더가없으면_비회원으로200이다")
		void areaRequests_guest_ok() throws Exception {
			mockMvc.perform(nearby(nearbyBody(ALL))).andExpect(status().isOk());
			mockMvc.perform(region(regionBody(ALL))).andExpect(status().isOk());
		}

		@Test
		@DisplayName("Authorization is ignored and request bodies are validated")
		void areaRequests_ignoredAuthorization_validatesBody() throws Exception {

			mockMvc.perform(nearby("{}").header("Authorization", "Bearer bad")).andExpect(status().isBadRequest());
			mockMvc.perform(region("{}").header("Authorization", "Bearer bad")).andExpect(status().isBadRequest());
			mockMvc.perform(nearby(nearbyBody(ALL)).header("Authorization", "Basic x"))
					.andExpect(status().isOk());
		}
	}

	@Nested
	@DisplayName("Mock 응답")
	class MockResponses {

		@Test
		@DisplayName("주변_영역안점수상위10곳을nearby로주고X-Fallback이없다")
		void nearby_wholeArea_topTenNearby() throws Exception {
			mockMvc.perform(nearby(nearbyBody(ALL)))
					.andExpect(status().isOk())
					.andExpect(header().doesNotExist("X-Fallback"))
					.andExpect(jsonPath("$.nearby").value(true))
					.andExpect(jsonPath("$.items", hasSize(10)))
					.andExpect(jsonPath("$.totalCount").value(10))
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
		}

		@Test
		@DisplayName("주변_empty시나리오여도_nearby다")
		void nearby_emptyScenario_nearby() throws Exception {
			mockMvc.perform(nearby(nearbyBody(ALL)).header("X-Mock-Scenario", "empty"))
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.nearby").value(true))
					.andExpect(jsonPath("$.emptyReason.cause").isString());
		}

		@Test
		@DisplayName("이지역에서검색_다음페이지도같은영역에서이어지고받은조건을돌려준다")
		void region_cursor_nextPageWithinArea() throws Exception {
			String first = mockMvc.perform(region("{\"query\":\"파스타\",\"conditions\":{\"text\":\"t\"},\"mapBounds\":"
							+ WEST + "}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(20)))
					.andExpect(jsonPath("$.totalCount").value(21))
					.andExpect(jsonPath("$.conditions.text").value("t"))
					.andExpect(jsonPath("$.changeSummary").doesNotExist())
					.andReturn().getResponse().getContentAsString();
			String next = com.jayway.jsonpath.JsonPath.read(first, "$.nextCursor");

			mockMvc.perform(region("{\"query\":\"파스타\",\"conditions\":{\"text\":\"t\"},\"mapBounds\":" + WEST
							+ ",\"cursor\":\"" + next + "\"}"))
					.andExpect(jsonPath("$.items", hasSize(1)))
					.andExpect(jsonPath("$.items[0].place.lng").value(org.hamcrest.Matchers.lessThanOrEqualTo(127.04)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
		}

		@Test
		@DisplayName("이지역에서검색_잘못된커서는_400이다")
		void region_invalidCursor_badRequest() throws Exception {
			mockMvc.perform(region("{\"query\":\"파스타\",\"mapBounds\":" + WEST + ",\"cursor\":\"a=\"}"))
					.andExpect(status().isBadRequest());
		}
	}

	private static final String LOG_SECRET = "비밀입력값5d2e";
	private static final String SECRET_LAT = "37.4987654321";
	private static final String SECRET_LNG = "127.0123456789";
	private static final String SECRET_BOUNDS = "{\"swLat\":" + SECRET_LAT + ",\"swLng\":" + SECRET_LNG
			+ ",\"neLat\":37.51,\"neLng\":127.06}";

	@Nested
	@DisplayName("로그")
	@ExtendWith(OutputCaptureExtension.class)
	class Logging {

		@Test
		@DisplayName("Successful and invalid requests do not log input or coordinates")
		void areaRequests_anyOutcome_doesNotLogInput(CapturedOutput output) throws Exception {
			String preferences = "\"preferences\":{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"" + LOG_SECRET + "\"}]}";

			mockMvc.perform(nearby("{\"mapBounds\":" + SECRET_BOUNDS + "," + preferences + "}"))
					.andExpect(status().isOk());
			mockMvc.perform(region("{\"query\":\"" + LOG_SECRET + "\",\"conditions\":{\"text\":\"" + LOG_SECRET
					+ "\"},\"mapBounds\":" + SECRET_BOUNDS + "}")).andExpect(status().isOk());
			mockMvc.perform(region("{\"query\":\"" + LOG_SECRET + "\",\"mapBounds\":{\"swLat\":" + SECRET_LAT
					+ ",\"swLng\":" + SECRET_LNG + ",\"neLat\":-1,\"neLng\":127.06}}")).andExpect(status().isBadRequest());
			mockMvc.perform(nearby("{\"mapBounds\":" + SECRET_BOUNDS + ",\"lat\":" + SECRET_LAT + "}"))
					.andExpect(status().isBadRequest());
			mockMvc.perform(region("{\"query\":\"" + LOG_SECRET + "\",\"mapBounds\":" + SECRET_BOUNDS + "}")
					.header("Authorization", "Bearer bad")).andExpect(status().isOk());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET).doesNotContain(SECRET_LAT).doesNotContain(SECRET_LNG);
		}
	}

}
