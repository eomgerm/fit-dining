package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Stream;
import kr.co.fitdining.api.review.store.InMemoryReviewStore;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 서비스와 메모리 저장소(시드 포함)로 리뷰 API를 확인한다. 시드는 1번 장소 25건, 2번 장소 1건이다.
 * 등록 테스트는 컨텍스트의 저장소를 함께 쓰므로 테스트마다 시드에 없는 새 장소 id를 쓴다.
 */
@WebMvcTest(controllers = ReviewController.class, properties = "review.mock.enabled=true")
@Import({ReviewService.class, InMemoryReviewStore.class, ReviewControllerTest.FixedClockConfig.class})
class ReviewControllerTest {

	/** 2026-10-21(수) 12:00 KST */
	@TestConfiguration
	static class FixedClockConfig {
		@Bean
		Clock clock() {
			return Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneId.of("Asia/Seoul"));
		}
	}

	private static final AtomicLong NEXT_PLACE_ID = new AtomicLong(1_000);

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JsonMapper jsonMapper;

	private static long newPlaceId() {
		return NEXT_PLACE_ID.incrementAndGet();
	}

	private static MockHttpServletRequestBuilder create(Object placeId, String body) {
		return post("/api/v1/places/{placeId}/reviews", placeId).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	private static MockHttpServletRequestBuilder list(Object placeId) {
		return get("/api/v1/places/{placeId}/reviews", placeId);
	}

	private JsonNode read(MockHttpServletRequestBuilder request) throws Exception {
		return jsonMapper.readTree(mockMvc.perform(request).andExpect(status().isOk())
				.andReturn().getResponse().getContentAsString());
	}

	@Nested
	@DisplayName("등록")
	class Create {

		@Test
		@DisplayName("등록_인증헤더없이_201과리뷰id를받는다")
		void create_noAuthorization_returnsCreatedWithId() throws Exception {
			mockMvc.perform(create(newPlaceId(), "{\"description\":\"분위기가 좋았어요\"}"))
					.andExpect(status().isCreated())
					.andExpect(content().contentType(MediaType.APPLICATION_JSON))
					.andExpect(jsonPath("$.reviewId").isNumber());
		}

		@Test
		@DisplayName("등록_본문없이도_201이다")
		void create_withoutDescription_returnsCreated() throws Exception {
			mockMvc.perform(create(newPlaceId(), "{}")).andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_Authorization헤더가있어도_무시하고201이다")
		void create_withAuthorization_ignoredAndCreated() throws Exception {
			mockMvc.perform(create(newPlaceId(), "{}").header("Authorization", "Bearer token"))
					.andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_같은장소에여러번_모두등록되고최신이맨위다")
		void create_samePlaceTwice_bothSavedNewestFirst() throws Exception {
			long placeId = newPlaceId();
			mockMvc.perform(create(placeId, "{\"description\":\"첫 번째\"}")).andExpect(status().isCreated());
			mockMvc.perform(create(placeId, "{\"description\":\"두 번째\"}")).andExpect(status().isCreated());

			mockMvc.perform(list(placeId))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.totalCount").value(2))
					.andExpect(jsonPath("$.items[0].description").value("두 번째"))
					.andExpect(jsonPath("$.items[1].description").value("첫 번째"))
					.andExpect(jsonPath("$.items[0].createdAt").value("2026-10-21T12:00:00+09:00"));
		}

		@Test
		@DisplayName("등록_공백뿐인본문이면_본문없이저장된다")
		void create_blankDescription_storedWithoutDescription() throws Exception {
			long placeId = newPlaceId();
			mockMvc.perform(create(placeId, "{\"description\":\"  \\n \"}")).andExpect(status().isCreated());

			mockMvc.perform(list(placeId))
					.andExpect(jsonPath("$.items[0].reviewId").isNumber())
					.andExpect(jsonPath("$.items[0].description").doesNotExist());
		}

		@Test
		@DisplayName("등록_본문이500자면_201이다")
		void create_description500_returnsCreated() throws Exception {
			mockMvc.perform(create(newPlaceId(), "{\"description\":\"" + "가".repeat(500) + "\"}"))
					.andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_본문이501자면_400이다")
		void create_description501_returnsBadRequest() throws Exception {
			expectBadRequest(create(newPlaceId(), "{\"description\":\"" + "가".repeat(501) + "\"}"));
		}
	}

	@Nested
	@DisplayName("요청 본문 검증")
	class RequestBodyValidation {

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"description\":\"좋았어요\",\"userId\":1}",
				"{\"visitedAt\":\"2026-10-21\"}"
		})
		@DisplayName("등록_정의되지않은속성이있으면_400이다")
		void create_unknownProperty_returnsBadRequest(String body) throws Exception {
			expectBadRequest(create(newPlaceId(), body));
		}

		@ParameterizedTest
		@ValueSource(strings = {"{\"description\":\"좋았어요\"", "{\"description\":{\"text\":\"좋았어요\"}}", ""})
		@DisplayName("등록_본문을읽을수없으면_400이다")
		void create_unreadableBody_returnsBadRequest(String body) throws Exception {
			expectBadRequest(create(newPlaceId(), body));
		}
	}

	@Nested
	@DisplayName("장소 id 검증")
	class PlaceIdValidation {

		@ParameterizedTest
		@ValueSource(strings = {"abc", "0", "-1", "9223372036854775808"})
		@DisplayName("목록_placeId가양의정수가아니면_400이다")
		void list_invalidPlaceId_returnsBadRequest(String placeId) throws Exception {
			expectBadRequest(list(placeId));
		}

		@ParameterizedTest
		@ValueSource(strings = {"abc", "0", "-1", "9223372036854775808"})
		@DisplayName("등록_placeId가양의정수가아니면_400이다")
		void create_invalidPlaceId_returnsBadRequest(String placeId) throws Exception {
			expectBadRequest(create(placeId, "{}"));
		}

		@Test
		@DisplayName("등록_장소존재를확인하지않아_검색에없는장소에도201이다")
		void create_placeNotInSearch_returnsCreated() throws Exception {
			mockMvc.perform(create(Long.MAX_VALUE, "{}")).andExpect(status().isCreated());
		}
	}

	@Nested
	@DisplayName("목록")
	class ListReviews {

		@Test
		@DisplayName("목록_시드25건이면_20건과5건으로중복없이나뉜다")
		void list_seed25_pagesWithoutOverlap() throws Exception {
			JsonNode first = read(list(1));
			JsonNode second = read(list(1).param("cursor", first.get("nextCursor").asString()));

			assertThat(first.get("totalCount").asInt()).isEqualTo(25);
			assertThat(first.get("items")).hasSize(20);
			assertThat(second.get("items")).hasSize(5);
			assertThat(second.has("nextCursor")).isFalse();
			List<Long> ids = new ArrayList<>();
			first.get("items").forEach(item -> ids.add(item.get("reviewId").asLong()));
			second.get("items").forEach(item -> ids.add(item.get("reviewId").asLong()));
			assertThat(ids).doesNotHaveDuplicates().hasSize(25);
		}

		@Test
		@DisplayName("목록_작성시각내림차순이다")
		void list_seed_newestFirst() throws Exception {
			JsonNode items = read(list(1)).get("items");

			List<String> createdAts = new ArrayList<>();
			items.forEach(item -> createdAts.add(item.get("createdAt").asString()));
			assertThat(createdAts).isSortedAccordingTo((a, b) -> b.compareTo(a));
			assertThat(createdAts.getFirst()).isEqualTo("2026-10-20T15:00:00+09:00");
		}

		@Test
		@DisplayName("목록_리뷰가없는장소면_빈목록과0이다")
		void list_placeWithoutReviews_emptyAndZero() throws Exception {
			mockMvc.perform(list(newPlaceId()))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.totalCount").value(0))
					.andExpect(jsonPath("$.items", hasSize(0)))
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
		}

		@ParameterizedTest
		@ValueSource(strings = {"not-a-cursor!", "YQ==", "YQ"})
		@DisplayName("목록_커서를해석할수없으면_400이다")
		void list_invalidCursor_returnsBadRequest(String cursor) throws Exception {
			expectBadRequest(list(1).param("cursor", cursor));
		}
	}

	@Nested
	@DisplayName("응답 형태")
	class ResponseShape {

		private static final Set<String> LIST = Set.of("totalCount", "items", "nextCursor");
		private static final Set<String> ITEM = Set.of("reviewId", "createdAt", "description");

		@Test
		@DisplayName("목록_응답키는_문서화된필드를벗어나지않는다")
		void list_responseKeys_documentedOnly() throws Exception {
			JsonNode page = read(list(1));

			assertThat(Set.copyOf(page.propertyNames())).isSubsetOf(LIST);
			page.get("items").forEach(item -> assertThat(Set.copyOf(item.propertyNames())).isSubsetOf(ITEM));
		}

		@Test
		@DisplayName("등록_응답키는_reviewId하나다")
		void create_responseKeys_reviewIdOnly() throws Exception {
			String body = mockMvc.perform(create(newPlaceId(), "{}")).andExpect(status().isCreated())
					.andReturn().getResponse().getContentAsString();

			assertThat(Set.copyOf(jsonMapper.readTree(body).propertyNames())).containsExactly("reviewId");
			assertThat(JsonPath.<Integer>read(body, "$.reviewId")).isPositive();
		}
	}

	@Nested
	@DisplayName("로그")
	@ExtendWith(OutputCaptureExtension.class)
	class Logging {

		@Test
		@DisplayName("등록_정상요청후_로그에본문이없다")
		void create_success_doesNotLogDescription(CapturedOutput output) throws Exception {
			mockMvc.perform(create(newPlaceId(), "{\"description\":\"" + LOG_SECRET + "\"}"))
					.andExpect(status().isCreated());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET);
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.review.ReviewControllerTest#badRequestsWithSecret")
		@DisplayName("등록과목록_잘못된요청으로400이나도_로그에입력값이없다")
		void request_badRequest_doesNotLogInput(String scenario, MockHttpServletRequestBuilder request,
				CapturedOutput output) throws Exception {
			mockMvc.perform(request).andExpect(status().isBadRequest());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET);
		}
	}

	private static final String LOG_SECRET = "비밀본문7f3a";

	static Stream<Arguments> badRequestsWithSecret() {
		return Stream.of(
				Arguments.of("501자 본문", create(1, "{\"description\":\"" + LOG_SECRET + "가".repeat(501) + "\"}")),
				Arguments.of("정의되지 않은 속성", create(1, "{\"description\":\"" + LOG_SECRET + "\",\"userId\":1}")),
				Arguments.of("문자열 자리의 객체", create(1, "{\"description\":{\"text\":\"" + LOG_SECRET + "\"}}")),
				Arguments.of("깨진 JSON", create(1, "{\"description\":\"" + LOG_SECRET + "\"")),
				Arguments.of("잘못된 cursor", list(1).param("cursor", LOG_SECRET)));
	}

	private void expectBadRequest(MockHttpServletRequestBuilder request) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().isBadRequest())
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(400))
				.andExpect(jsonPath("$.detail").isString());
	}

}
