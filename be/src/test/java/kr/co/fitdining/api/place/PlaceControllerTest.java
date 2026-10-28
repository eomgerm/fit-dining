package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import kr.co.fitdining.api.place.dto.OpenStatus;
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
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@WebMvcTest(controllers = PlaceController.class, properties = "place.mock.enabled=true")
@Import({PlaceService.class, MockPlaceSearchEngine.class, PlaceControllerTest.FixedClockConfig.class})
class PlaceControllerTest {

	/** 2026-10-21(수) 12:00 KST. 응답의 영업 상태를 고정한다. */
	@TestConfiguration
	static class FixedClockConfig {
		@Bean
		Clock clock() {
			return Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneId.of("Asia/Seoul"));
		}
	}

	@Autowired
	MockMvc mockMvc;

	@Nested
	@DisplayName("자동완성")
	class Suggest {

		@Test
		@DisplayName("자동완성_이름접두일치가있으면_장소가맨위이고_추천받기가맨뒤다")
		void suggest_namePrefixMatch_placesFirstAndActionLast() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "커피"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$", hasSize(6)))
					.andExpect(jsonPath("$[0:5].type", contains("PLACE", "PLACE", "PLACE", "PLACE", "PLACE")))
					.andExpect(jsonPath("$[0:5].place.id", contains(18, 33, 8, 27, 36)))
					.andExpect(jsonPath("$[5].type").value("ACTION"))
					.andExpect(jsonPath("$[5].label").value("이 조건으로 추천받기"))
					.andExpect(jsonPath("$[5].place").doesNotExist())
					.andExpect(jsonPath("$[0].label").doesNotExist());
		}

		@Test
		@DisplayName("자동완성_이름접두일치가없으면_추천받기가맨위다")
		void suggest_noNamePrefixMatch_actionFirst() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "국밥"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$", hasSize(5)))
					.andExpect(jsonPath("$[0].type").value("ACTION"))
					.andExpect(jsonPath("$[1:].place.id", contains(9, 13, 14, 31)));
		}

		@Test
		@DisplayName("자동완성_메뉴이름으로만일치하면_matchedMenu에그메뉴를담는다")
		void suggest_menuOnlyMatch_setsMatchedMenu() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "국밥"))
					.andExpect(jsonPath("$[1].place.name").value("농민백암순대 본점"))
					.andExpect(jsonPath("$[1].matchedMenu").value("국밥"))
					.andExpect(jsonPath("$[2].matchedMenu").value("한우우거지국밥"))
					.andExpect(jsonPath("$[3].place.name").value("미례국밥 강남삼성타운점"))
					.andExpect(jsonPath("$[3].matchedMenu").doesNotExist());
		}

		@Test
		@DisplayName("자동완성_업종이나메뉴일치는_순서에영향이없고_접두일치뒤에온다")
		void suggest_categoryMatch_comesAfterPrefixMatches() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "카페"))
					.andExpect(jsonPath("$[0:5].place.id", contains(7, 1, 3, 4, 6)))
					.andExpect(jsonPath("$[5].type").value("ACTION"));
		}

		@Test
		@DisplayName("자동완성_앞뒤공백과대소문자는_무시한다")
		void suggest_paddedMixedCaseQuery_matchesIgnoringCase() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "  cLASSIC "))
					.andExpect(jsonPath("$", hasSize(2)))
					.andExpect(jsonPath("$[0].type").value("ACTION"))
					.andExpect(jsonPath("$[1].place.id").value(2))
					.andExpect(jsonPath("$[1].matchedMenu").value("Classic Cocktail"));
		}

		@Test
		@DisplayName("자동완성_업종코드의부분문자열이면_그업종장소를최대5개담는다")
		void suggest_categoryCode_limitsToFivePlaces() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "Bar"))
					.andExpect(jsonPath("$", hasSize(6)))
					.andExpect(jsonPath("$[0].type").value("ACTION"))
					.andExpect(jsonPath("$[1:].place.id", contains(2, 10, 11, 12, 15)));
		}
	}

	@Nested
	@DisplayName("추천 검색")
	class Search {

		@Test
		@DisplayName("추천검색_헤더없는일반질의는_20개와커서를주고_커서로나머지를준다")
		void search_plainQuery_pagesWithCursor() throws Exception {
			String first = mockMvc.perform(search("{\"query\":\"역삼에서 조용히 대화하기 좋은 카페\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(20)))
					.andExpect(jsonPath("$.totalCount").value(36))
					.andExpect(jsonPath("$.nearby").value(false))
					.andExpect(jsonPath("$.nextCursor").isString())
					.andReturn().getResponse().getContentAsString();
			String cursor = JsonPath.read(first, "$.nextCursor");

			String second = mockMvc.perform(search(
							"{\"query\":\"역삼에서 조용히 대화하기 좋은 카페\",\"cursor\":\"" + cursor + "\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(16)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist())
					.andReturn().getResponse().getContentAsString();

			List<Integer> firstIds = JsonPath.read(first, "$.items[*].place.id");
			List<Integer> secondIds = JsonPath.read(second, "$.items[*].place.id");
			assertThat(firstIds).doesNotContainAnyElementsOf(secondIds);
			assertThat(Stream.concat(firstIds.stream(), secondIds.stream()).distinct()).hasSize(36);
		}

		@Test
		@DisplayName("추천검색_결과는_점수내림차순이다")
		void search_plainQuery_sortedByScoreDescending() throws Exception {
			String body = mockMvc.perform(search("{\"query\":\"카페\"}"))
					.andReturn().getResponse().getContentAsString();
			List<Integer> scores = JsonPath.read(body, "$.items[*].score");
			assertThat(scores).isSortedAccordingTo(Comparator.reverseOrder());
		}

		@Test
		@DisplayName("추천검색_empty시나리오헤더면_200과빈목록과원인을준다")
		void search_emptyScenario_returnsEmptyReason() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\"}").header("X-Mock-Scenario", "empty"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.totalCount").value(0))
					.andExpect(jsonPath("$.emptyReason.cause").isNotEmpty())
					.andExpect(jsonPath("$.emptyReason.suggestion").isNotEmpty())
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
		}

		@Test
		@DisplayName("추천검색_empty와근처가함께있으면_empty가이긴다")
		void search_emptyScenarioWithNearby_emptyWins() throws Exception {
			mockMvc.perform(search("{\"query\":\"근처 카페\"}").header("X-Mock-Scenario", "empty"))
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.nearby").value(false));
		}

		@Test
		@DisplayName("추천검색_알수없는시나리오헤더는_정상결과다")
		void search_unknownScenario_returnsNormalResult() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\"}").header("X-Mock-Scenario", "error"))
					.andExpect(jsonPath("$.items", hasSize(20)));
		}

		@Test
		@DisplayName("추천검색_질의에근처가있으면_커서없이후보전체를점수순으로준다")
		void search_nearbyQuery_returnsAllWithoutCursor() throws Exception {
			String body = mockMvc.perform(search("{\"query\":\"내 근처 조용한 카페\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.nearby").value(true))
					.andExpect(jsonPath("$.items", hasSize(36)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist())
					.andReturn().getResponse().getContentAsString();
			List<Integer> scores = JsonPath.read(body, "$.items[*].score");
			assertThat(scores).isSortedAccordingTo(Comparator.reverseOrder());
		}

		@Test
		@DisplayName("추천검색_previousConditions를넣으면_conditions에그대로담고_changeSummary를준다")
		void search_previousConditions_echoedAsConditions() throws Exception {
			mockMvc.perform(search("""
							{"query":"더 조용하게","previousConditions":{"area":"역삼","quiet":true,"tags":["a"],"unset":null}}
							"""))
					.andExpect(status().isOk())
					.andExpect(content().json("""
							{"conditions":{"area":"역삼","quiet":true,"tags":["a"],"unset":null}}
							"""))
					.andExpect(jsonPath("$.conditions.unset").value(nullValue()))
					.andExpect(jsonPath("$.changeSummary").value("요청하신 조건을 반영했어요"));
		}

		@Test
		@DisplayName("추천검색_빈previousConditions도_있는것으로본다")
		void search_emptyPreviousConditions_treatedAsPresent() throws Exception {
			mockMvc.perform(search("{\"query\":\"더 조용하게\",\"previousConditions\":{}}"))
					.andExpect(jsonPath("$.conditions").isMap())
					.andExpect(jsonPath("$.conditions").isEmpty())
					.andExpect(jsonPath("$.changeSummary").isString());
		}

		@Test
		@DisplayName("추천검색_previousConditions가없거나null이면_빈conditions이고_changeSummary가없다")
		void search_noPreviousConditions_emptyConditions() throws Exception {
			for (String body : List.of("{\"query\":\"카페\"}", "{\"query\":\"카페\",\"previousConditions\":null}")) {
				mockMvc.perform(search(body))
						.andExpect(jsonPath("$.conditions").isMap())
						.andExpect(jsonPath("$.conditions").isEmpty())
						.andExpect(jsonPath("$.changeSummary").doesNotExist());
			}
		}

		@Test
		@DisplayName("추천검색_커서요청은_질의와헤더를무시하고_오프셋만따른다")
		void search_cursorRequest_ignoresQueryAndScenario() throws Exception {
			mockMvc.perform(search("{\"query\":\"근처\",\"cursor\":\"" + cursor("20") + "\"}")
							.header("X-Mock-Scenario", "empty"))
					.andExpect(jsonPath("$.items", hasSize(16)))
					.andExpect(jsonPath("$.nearby").value(false))
					.andExpect(jsonPath("$.totalCount").value(36))
					.andExpect(jsonPath("$.emptyReason").doesNotExist())
					.andExpect(jsonPath("$.changeSummary").doesNotExist());
		}

		@Test
		@DisplayName("추천검색_남은항목이정확히한페이지면_다음커서가없다")
		void search_cursorToExactlyFullLastPage_hasNoNextCursor() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"" + cursor("16") + "\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(20)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
		}

		@Test
		@DisplayName("추천검색_근처질의에previousConditions를넣으면_changeSummary를준다")
		void search_nearbyWithPreviousConditions_hasChangeSummary() throws Exception {
			mockMvc.perform(search("{\"query\":\"근처 카페\",\"previousConditions\":{\"area\":\"역삼\"}}"))
					.andExpect(jsonPath("$.nearby").value(true))
					.andExpect(jsonPath("$.conditions.area").value("역삼"))
					.andExpect(jsonPath("$.changeSummary").value("요청하신 조건을 반영했어요"));
		}

		@Test
		@DisplayName("추천검색_empty시나리오에previousConditions를넣으면_changeSummary를준다")
		void search_emptyScenarioWithPreviousConditions_hasChangeSummary() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"previousConditions\":{\"area\":\"역삼\"}}")
							.header("X-Mock-Scenario", "empty"))
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.conditions.area").value("역삼"))
					.andExpect(jsonPath("$.changeSummary").value("요청하신 조건을 반영했어요"));
		}

		@Test
		@DisplayName("추천검색_빈커서는_첫페이지다")
		void search_emptyCursor_returnsFirstPage() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"\"}"))
					.andExpect(jsonPath("$.items", hasSize(20)))
					.andExpect(jsonPath("$.nextCursor").isString());
		}

		@Test
		@DisplayName("추천검색_오프셋이장소수이상이면_빈페이지다")
		void search_cursorPastEnd_returnsEmptyPage() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"" + cursor("36") + "\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist())
					.andExpect(jsonPath("$.emptyReason").doesNotExist());
		}

		@Test
		@DisplayName("추천검색_int최댓값오프셋커서도_다음커서없는빈페이지다")
		void search_maxIntOffsetCursor_returnsEmptyPageWithoutNextCursor() throws Exception {
			mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"" + cursor(Integer.toString(Integer.MAX_VALUE)) + "\"}"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist())
					.andExpect(jsonPath("$.emptyReason").doesNotExist());
		}

		@ParameterizedTest
		@ValueSource(strings = {"MjA=", "!!", "MDA", "LTE", "YWJj", "OTk5OTk5OTk5OTk5"})
		@DisplayName("추천검색_잘못된커서는_400이다")
		void search_invalidCursor_returnsBadRequest(String cursor) throws Exception {
			// 패딩, base64url 아님, "00", "-1", "abc", int 범위 밖
			mockMvc.perform(search("{\"query\":\"카페\",\"cursor\":\"" + cursor + "\"}"))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}
	}

	@Nested
	@DisplayName("장소 상세")
	class Detail {

		@Test
		@DisplayName("장소상세_알려진id면_영업시간메뉴시설을준다")
		void getPlace_knownId_returnsDetail() throws Exception {
			mockMvc.perform(get("/api/v1/places/{id}", 1))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.place.id").value(1))
					.andExpect(jsonPath("$.place.name").value("모너트 MONERT"))
					.andExpect(jsonPath("$.hours", hasSize(7)))
					.andExpect(jsonPath("$.hours[*].dayOfWeek", contains("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")))
					.andExpect(jsonPath("$.menus[0].category").isString())
					.andExpect(jsonPath("$.menus[0].name").isString())
					.andExpect(jsonPath("$.facilities").isArray())
					.andExpect(jsonPath("$.tags").isArray())
					.andExpect(jsonPath("$.photos").isArray())
					.andExpect(jsonPath("$.openStatus").isString())
					.andExpect(jsonPath("$.address").isString());
		}

		@Test
		@DisplayName("장소상세_응답에는_점수와추천이유가없다")
		void getPlace_knownId_hasNoSearchContext() throws Exception {
			mockMvc.perform(get("/api/v1/places/{id}", 1))
					.andExpect(jsonPath("$.score").doesNotExist())
					.andExpect(jsonPath("$.reasons").doesNotExist())
					.andExpect(jsonPath("$.scoreItems").doesNotExist());
		}

		@Test
		@DisplayName("장소상세_모르는id면_404다")
		void getPlace_unknownId_returnsNotFound() throws Exception {
			mockMvc.perform(get("/api/v1/places/{id}", 999))
					.andExpect(status().isNotFound())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.status").value(404));
		}

		@ParameterizedTest
		@ValueSource(strings = {"abc", "1.5", "99999999999999999999"})
		@DisplayName("장소상세_정수가아닌id면_400이다")
		void getPlace_nonIntegerId_returnsBadRequest(String id) throws Exception {
			mockMvc.perform(get("/api/v1/places/{id}", id))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.status").value(400));
		}
	}

	@Nested
	@DisplayName("요청 본문 검증")
	class RequestBodyValidation {

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"query\":\"카페\",\"lat\":37.5,\"lng\":127.0}",
				"{\"query\":\"카페\",\"mapBounds\":{\"swLat\":37.4,\"zoom\":15}}"
		})
		@DisplayName("추천검색_정의되지않은속성이있으면_400이다")
		void search_unknownProperty_returnsBadRequest(String body) throws Exception {
			mockMvc.perform(search(body))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.status").value(400));
		}

		@Test
		@DisplayName("추천검색_정의된필드만있으면_정상처리한다")
		void search_definedFieldsOnly_returnsOk() throws Exception {
			mockMvc.perform(search("""
							{"query":"카페","preferences":["QUIET","아무 태그"],
							 "previousConditions":{"lat":37.5,"any":{"nested":[1,2]}},
							 "mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":null},"cursor":null}
							"""))
					.andExpect(status().isOk());
		}

		@Test
		@DisplayName("추천검색_숫자질의는_문자열로받는다")
		void search_numericQuery_coercedToString() throws Exception {
			mockMvc.perform(search("{\"query\":123}"))
					.andExpect(status().isOk());
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"query\":{\"text\":\"카페\"}}",
				"{\"query\":\"카페\",\"previousConditions\":[1,2]}",
				"{\"query\":\"카페\"",
				""
		})
		@DisplayName("추천검색_변환할수없는본문은_400이다")
		void search_unreadableBody_returnsBadRequest(String body) throws Exception {
			mockMvc.perform(search(body))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}
	}

	@Nested
	@DisplayName("검색어 길이 검증")
	class QueryLength {

		@ParameterizedTest
		@MethodSource("kr.co.fitdining.api.place.PlaceControllerTest#invalidQueries")
		@DisplayName("자동완성_비었거나공백이거나200자를넘는q는_400이다")
		void suggest_invalidQ_returnsBadRequest(String q) throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", q))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("자동완성_q가없으면_400이다")
		void suggest_missingQ_returnsBadRequest() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest"))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("자동완성_200자인q는_정상처리한다")
		void suggest_maxLengthQ_returnsOk() throws Exception {
			mockMvc.perform(get("/api/v1/places/suggest").param("q", "가".repeat(200)))
					.andExpect(status().isOk());
		}

		@ParameterizedTest
		@MethodSource("kr.co.fitdining.api.place.PlaceControllerTest#invalidQueries")
		@DisplayName("추천검색_비었거나공백이거나200자를넘는query는_400이다")
		void search_invalidQuery_returnsBadRequest(String query) throws Exception {
			mockMvc.perform(search("{\"query\":\"" + query + "\"}"))
					.andExpect(status().isBadRequest())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@ParameterizedTest
		@ValueSource(strings = {"{}", "{\"query\":null}"})
		@DisplayName("추천검색_query가없으면_400이다")
		void search_missingQuery_returnsBadRequest(String body) throws Exception {
			mockMvc.perform(search(body))
					.andExpect(status().isBadRequest());
		}

		@Test
		@DisplayName("추천검색_200자인query는_정상처리한다")
		void search_maxLengthQuery_returnsOk() throws Exception {
			mockMvc.perform(search("{\"query\":\"" + "가".repeat(200) + "\"}"))
					.andExpect(status().isOk());
		}
	}

	static Stream<String> invalidQueries() {
		return Stream.of("", "   ", "가".repeat(201));
	}

	@Nested
	@DisplayName("인증과 취향")
	class AuthorizationAndPreferences {

		@ParameterizedTest(name = "{0}")
		@ValueSource(strings = {"suggest", "search", "detail"})
		@DisplayName("엔드포인트_Authorization헤더가있든없든_응답이같다")
		void endpoint_withOrWithoutAuthorization_sameResponse(String endpoint) throws Exception {
			String plain = mockMvc.perform(request(endpoint)).andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString();

			mockMvc.perform(request(endpoint).header("Authorization", "Bearer token"))
					.andExpect(status().isOk())
					.andExpect(content().json(plain, JsonCompareMode.STRICT));
		}

		private static MockHttpServletRequestBuilder request(String endpoint) {
			return switch (endpoint) {
				case "suggest" -> get("/api/v1/places/suggest").param("q", "역삼");
				case "search" -> search("{\"query\":\"카페\"}");
				default -> get("/api/v1/places/{id}", 3);
			};
		}

		@Test
		@DisplayName("추천검색_preferences는받지만_Mock결과에반영하지않는다")
		void search_preferences_acceptedButIgnored() throws Exception {
			String plain = mockMvc.perform(search("{\"query\":\"카페\"}"))
					.andReturn().getResponse().getContentAsString();
			mockMvc.perform(search("{\"query\":\"카페\",\"preferences\":[\"QUIET\",\"PARKING\"]}"))
					.andExpect(status().isOk())
					.andExpect(content().json(plain, JsonCompareMode.STRICT));
		}
	}

	@Nested
	@DisplayName("로그")
	@ExtendWith(OutputCaptureExtension.class)
	class Logging {

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.place.PlaceControllerTest#successfulRequestsWithSecret")
		@DisplayName("검색과자동완성_정상요청후_로그에입력값이없다")
		void request_success_doesNotLogInput(String scenario, MockHttpServletRequestBuilder request,
				CapturedOutput output) throws Exception {
			mockMvc.perform(request).andExpect(status().isOk());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET);
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.place.PlaceControllerTest#badRequestsWithSecret")
		@DisplayName("검색과자동완성_잘못된요청으로400이나도_로그에입력값이없다")
		void request_badRequest_doesNotLogInput(String scenario, MockHttpServletRequestBuilder request,
				CapturedOutput output) throws Exception {
			mockMvc.perform(request).andExpect(status().isBadRequest());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET).doesNotContain(LOG_SECRET_COORDINATE);
		}
	}

	private static final String LOG_SECRET = "비밀입력값7f3a";
	private static final String LOG_SECRET_COORDINATE = "37.512345";

	static Stream<Arguments> successfulRequestsWithSecret() {
		return Stream.of(
				Arguments.of("자동완성", get("/api/v1/places/suggest").param("q", LOG_SECRET + "q")),
				Arguments.of("추천검색", search(
						"{\"query\":\"" + LOG_SECRET + "query\",\"preferences\":[\"" + LOG_SECRET + "pref\"]}")));
	}

	static Stream<Arguments> badRequestsWithSecret() {
		return Stream.of(
				Arguments.of("200자를 넘는 q", get("/api/v1/places/suggest").param("q", LOG_SECRET + "가".repeat(200))),
				Arguments.of("정의되지 않은 좌표 속성",
						search("{\"query\":\"" + LOG_SECRET + "\",\"lat\":" + LOG_SECRET_COORDINATE + "}")),
				Arguments.of("문자열 자리의 객체", search(
						"{\"query\":{\"text\":\"" + LOG_SECRET + "\"},\"preferences\":[\"" + LOG_SECRET + "\"]}")),
				Arguments.of("깨진 JSON", search("{\"query\":\"" + LOG_SECRET + "\"")),
				Arguments.of("200자를 넘는 query", search("{\"query\":\"" + LOG_SECRET + "가".repeat(200) + "\"}")),
				Arguments.of("잘못된 cursor",
						search("{\"query\":\"" + LOG_SECRET + "\",\"cursor\":\"" + LOG_SECRET + "\"}")));
	}

	@Nested
	@DisplayName("응답 형태")
	class ResponseShape {

		private static final Set<String> SUMMARY = Set.of("id", "name", "categoryGroup", "station", "lat", "lng",
				"thumbnailUrl");
		private static final Set<String> SUGGESTION = Set.of("type", "place", "matchedMenu", "label");
		private static final Set<String> SEARCH = Set.of("conditions", "nearby", "totalCount", "items", "nextCursor",
				"emptyReason", "changeSummary");
		private static final Set<String> EMPTY_REASON = Set.of("cause", "suggestion");
		private static final Set<String> CARD = Set.of("place", "score", "labels", "caution", "openStatus", "reasons",
				"scoreItems");
		private static final Set<String> REASON = Set.of("title", "tags", "quote", "quoteSource");
		private static final Set<String> REASON_TAG = Set.of("source", "label");
		private static final Set<String> SCORE_ITEM = Set.of("source", "label", "matched", "evidenceCount");
		private static final Set<String> DETAIL = Set.of("place", "address", "tags", "photos", "phone", "website",
				"openStatus", "hours", "closedDayNote", "menus", "facilities", "subways", "directions", "parking", "pet",
				"noKidsZone", "corkage", "bookingUrl", "seats", "description", "paymentMethods", "broadcasts",
				"extraLinks");
		private static final Set<String> HOURS = Set.of("dayOfWeek", "open", "close", "breaks", "lastOrders", "closed");
		private static final Set<String> BREAK = Set.of("start", "end");
		private static final Set<String> MENU = Set.of("category", "name", "description", "price", "priceText", "labels",
				"representative", "photoUrl");
		private static final Set<String> SUBWAY = Set.of("station", "line", "exit", "walkMinutes");
		private static final Set<String> PARKING = Set.of("free", "note", "valet");
		private static final Set<String> POLICY = Set.of("allowed", "note");
		private static final Set<String> SEAT = Set.of("name", "description");
		private static final Set<String> BROADCAST = Set.of("channel", "program", "episode", "airedOn", "menu");

		/** {@code ?}가 없는 필드. 모든 장소의 응답에 있어야 한다. */
		private static final Set<String> DETAIL_REQUIRED = Set.of("place", "address", "tags", "photos", "openStatus",
				"hours", "menus", "facilities", "subways", "noKidsZone", "seats", "paymentMethods", "broadcasts",
				"extraLinks");
		private static final Set<String> HOURS_REQUIRED = Set.of("dayOfWeek", "breaks", "lastOrders", "closed");
		private static final Set<String> MENU_REQUIRED = Set.of("name", "labels", "representative");

		@Autowired
		JsonMapper jsonMapper;

		@Test
		@DisplayName("자동완성_응답키는_문서화된필드를벗어나지않는다")
		void suggest_responseKeys_withinDocumentedFields() throws Exception {
			for (String q : List.of("역삼", "쌀국수", "카페", "bar")) {
				for (JsonNode suggestion : read(get("/api/v1/places/suggest").param("q", q))) {
					assertKeys(suggestion, SUGGESTION);
					if (suggestion.has("place")) {
						assertKeys(suggestion.get("place"), SUMMARY);
					}
				}
			}
		}

		@Test
		@DisplayName("추천검색_응답키는_문서화된필드를벗어나지않는다")
		void search_responseKeys_withinDocumentedFields() throws Exception {
			List<MockHttpServletRequestBuilder> requests = List.of(
					search("{\"query\":\"근처 카페\",\"previousConditions\":{\"anyKey\":1}}"),
					search("{\"query\":\"카페\"}").header("X-Mock-Scenario", "empty"));
			for (MockHttpServletRequestBuilder request : requests) {
				JsonNode response = read(request);
				assertKeys(response, SEARCH);
				if (response.has("emptyReason")) {
					assertKeys(response.get("emptyReason"), EMPTY_REASON);
				}
				for (JsonNode card : response.get("items")) {
					assertKeys(card, CARD);
					assertKeys(card.get("place"), SUMMARY);
					for (JsonNode reason : card.get("reasons")) {
						assertKeys(reason, REASON);
						reason.get("tags").forEach(tag -> assertKeys(tag, REASON_TAG));
					}
					card.get("scoreItems").forEach(item -> assertKeys(item, SCORE_ITEM));
				}
			}
		}

		@Test
		@DisplayName("장소상세_모든장소의응답키는_문서화된필드를벗어나지않고_필수필드가있다")
		void getPlace_responseKeys_withinDocumentedFields() throws Exception {
			int count = read(search("{\"query\":\"근처\"}")).get("totalCount").asInt();
			assertThat(count).isPositive();
			for (int id = 1; id <= count; id++) {
				JsonNode detail = read(get("/api/v1/places/{id}", id));
				assertKeys(detail, DETAIL);
				assertRequired(detail, DETAIL_REQUIRED);
				assertKeys(detail.get("place"), SUMMARY);
				assertThat(detail.get("hours")).hasSize(7);
				for (JsonNode hours : detail.get("hours")) {
					assertKeys(hours, HOURS);
					assertRequired(hours, HOURS_REQUIRED);
					assertThat(hours.get("breaks").isArray()).isTrue();
					assertThat(hours.get("lastOrders").isArray()).isTrue();
					for (JsonNode pause : hours.get("breaks")) {
						assertKeys(pause, BREAK);
						assertRequired(pause, BREAK);
					}
				}
				for (JsonNode menu : detail.get("menus")) {
					assertKeys(menu, MENU);
					assertRequired(menu, MENU_REQUIRED);
				}
				detail.get("facilities").forEach(facility -> assertThat(facility.isString()).isTrue());
				for (JsonNode subway : detail.get("subways")) {
					assertKeys(subway, SUBWAY);
					assertRequired(subway, Set.of("station"));
				}
				if (detail.has("parking")) {
					assertKeys(detail.get("parking"), PARKING);
					assertRequired(detail.get("parking"), Set.of("valet"));
				}
				for (String policy : List.of("pet", "corkage")) {
					if (detail.has(policy)) {
						assertKeys(detail.get(policy), POLICY);
					}
				}
				for (JsonNode seat : detail.get("seats")) {
					assertKeys(seat, SEAT);
					assertRequired(seat, Set.of("name"));
				}
				detail.get("broadcasts").forEach(broadcast -> assertKeys(broadcast, BROADCAST));
			}
		}

		@Test
		@DisplayName("추천검색_카드의점수라벨근거수영업상태는_정의된범위다")
		void search_cards_valuesWithinDefinedRanges() throws Exception {
			JsonNode first = read(search("{\"query\":\"카페\"}"));
			JsonNode second = read(search("{\"query\":\"카페\",\"cursor\":\"" + first.get("nextCursor").asString() + "\"}"));
			Set<String> statuses = Arrays.stream(OpenStatus.values()).map(Enum::name).collect(Collectors.toSet());
			for (JsonNode page : List.of(first, second)) {
				for (JsonNode card : page.get("items")) {
					assertThat(card.get("score").isInt()).isTrue();
					assertThat(card.get("score").asInt()).isBetween(0, 100);
					assertThat(card.get("labels").size()).isEqualTo(2);
					assertThat(statuses).contains(card.get("openStatus").asString());
					for (JsonNode item : card.get("scoreItems")) {
						assertThat(item.get("evidenceCount").isInt()).isTrue();
						assertThat(item.get("evidenceCount").asInt()).isGreaterThanOrEqualTo(0);
					}
				}
			}
		}

		private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
			String body = mockMvc.perform(request).andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString();
			return jsonMapper.readTree(body);
		}

		private static void assertKeys(JsonNode node, Set<String> documented) {
			assertThat(node.propertyNames()).isSubsetOf(documented);
		}

		private static void assertRequired(JsonNode node, Set<String> required) {
			assertThat(node.propertyNames()).containsAll(required);
		}
	}

	private static MockHttpServletRequestBuilder search(String body) {
		return post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON).content(body);
	}

	private static String cursor(String offset) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(offset.getBytes(StandardCharsets.UTF_8));
	}

}
