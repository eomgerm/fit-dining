package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.store.InvalidReviewCursorException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 리뷰 API의 요청 검증, 인증, 오류 응답을 확인한다. 저장과 목록 계산은 {@code ReviewPersistenceTest}가
 * 실제 PostgreSQL로 확인하므로 여기서는 서비스와 인증 모듈을 대신한다.
 */
@WebMvcTest(controllers = ReviewController.class)
class ReviewControllerTest {

	private static final String TOKEN = "valid-access-token";
	private static final String USER_ID = "user-1";

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JsonMapper jsonMapper;

	@MockitoBean
	ReviewService reviewService;

	@MockitoBean
	AuthUseCases auth;

	@BeforeEach
	void setUp() {
		when(auth.authenticate(TOKEN)).thenReturn(new AuthUseCases.Identity(USER_ID, null, null, 0, 0));
		when(reviewService.create(anyLong(), anyString(), any())).thenReturn(new ReviewCreateResponse(7L));
	}

	private static MockHttpServletRequestBuilder create(Object placeId, String body) {
		return post("/api/v1/places/{placeId}/reviews", placeId).contentType(MediaType.APPLICATION_JSON).content(body)
				.header("Authorization", "Bearer " + TOKEN);
	}

	private static MockHttpServletRequestBuilder createWithoutAuthorization(Object placeId, String body) {
		return post("/api/v1/places/{placeId}/reviews", placeId).contentType(MediaType.APPLICATION_JSON).content(body);
	}

	private static MockHttpServletRequestBuilder list(Object placeId) {
		return get("/api/v1/places/{placeId}/reviews", placeId);
	}

	@Nested
	@DisplayName("등록")
	class Create {

		@Test
		@DisplayName("등록_유효한토큰이면_201과리뷰id를받고작성자로저장한다")
		void create_validToken_returnsCreatedWithAuthor() throws Exception {
			mockMvc.perform(create(3, "{\"description\":\"분위기가 좋았어요\"}"))
					.andExpect(status().isCreated())
					.andExpect(content().contentType(MediaType.APPLICATION_JSON))
					.andExpect(jsonPath("$.reviewId").value(7));

			verify(reviewService).create(3L, USER_ID, new ReviewCreateRequest("분위기가 좋았어요"));
		}

		@Test
		@DisplayName("등록_본문없이도_201이다")
		void create_withoutDescription_returnsCreated() throws Exception {
			mockMvc.perform(create(3, "{}")).andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_본문이500자면_201이다")
		void create_description500_returnsCreated() throws Exception {
			mockMvc.perform(create(3, "{\"description\":\"" + "가".repeat(500) + "\"}"))
					.andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_본문이501자면_400이다")
		void create_description501_returnsBadRequest() throws Exception {
			expectProblem(create(3, "{\"description\":\"" + "가".repeat(501) + "\"}"), 400);
		}

		@Test
		@DisplayName("등록_같은장소에오늘이미썼으면_409다")
		void create_duplicateVisit_returnsConflict() throws Exception {
			when(reviewService.create(anyLong(), anyString(), any())).thenThrow(new DuplicateReviewException());

			expectProblem(create(3, "{}"), 409);
		}
	}

	@Nested
	@DisplayName("인증")
	class Authentication {

		@Test
		@DisplayName("등록_Authorization헤더가없으면_401이고저장하지않는다")
		void create_noAuthorization_returnsUnauthorized() throws Exception {
			expectProblem(createWithoutAuthorization(3, "{}"), 401);

			verify(reviewService, never()).create(anyLong(), anyString(), any());
		}

		@Test
		@DisplayName("등록_Bearer형식이아니면_401이다")
		void create_notBearer_returnsUnauthorized() throws Exception {
			expectProblem(createWithoutAuthorization(3, "{}").header("Authorization", "Basic " + TOKEN), 401);
		}

		@Test
		@DisplayName("등록_토큰이만료됐으면_401과만료type이다")
		void create_expiredToken_returnsUnauthorizedWithExpiredType() throws Exception {
			when(auth.authenticate("expired")).thenThrow(AuthFailure.accessExpired());

			mockMvc.perform(createWithoutAuthorization(3, "{}").header("Authorization", "Bearer expired"))
					.andExpect(status().isUnauthorized())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.type").value(AuthFailure.ACCESS_TOKEN_EXPIRED.toString()));
		}

		@Test
		@DisplayName("등록_토큰이유효하지않으면_401이다")
		void create_invalidToken_returnsUnauthorized() throws Exception {
			when(auth.authenticate("forged")).thenThrow(new AuthFailure("인증을 확인해주세요."));

			expectProblem(createWithoutAuthorization(3, "{}").header("Authorization", "Bearer forged"), 401);
		}

		@Test
		@DisplayName("목록_Authorization헤더없이_200이다")
		void list_noAuthorization_returnsOk() throws Exception {
			when(reviewService.list(3L, null)).thenReturn(new ReviewListResponse(0, List.of(), null));

			mockMvc.perform(list(3)).andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value(0));
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
			expectProblem(create(3, body), 400);
		}

		@ParameterizedTest
		@ValueSource(strings = {"{\"description\":\"좋았어요\"", "{\"description\":{\"text\":\"좋았어요\"}}", ""})
		@DisplayName("등록_본문을읽을수없으면_400이다")
		void create_unreadableBody_returnsBadRequest(String body) throws Exception {
			expectProblem(create(3, body), 400);
		}
	}

	@Nested
	@DisplayName("장소 id 검증")
	class PlaceIdValidation {

		@ParameterizedTest
		@ValueSource(strings = {"abc", "0", "-1", "9223372036854775808"})
		@DisplayName("목록_placeId가양의정수가아니면_400이다")
		void list_invalidPlaceId_returnsBadRequest(String placeId) throws Exception {
			expectProblem(list(placeId), 400);
		}

		@ParameterizedTest
		@ValueSource(strings = {"abc", "0", "-1", "9223372036854775808"})
		@DisplayName("등록_placeId가양의정수가아니면_400이다")
		void create_invalidPlaceId_returnsBadRequest(String placeId) throws Exception {
			expectProblem(create(placeId, "{}"), 400);
		}
	}

	@Nested
	@DisplayName("목록")
	class ListReviews {

		@Test
		@DisplayName("목록_커서를해석할수없으면_400이다")
		void list_invalidCursor_returnsBadRequest() throws Exception {
			when(reviewService.list(eq(3L), anyString())).thenThrow(new InvalidReviewCursorException());

			expectProblem(list(3).param("cursor", "not-a-cursor!"), 400);
		}

		@Test
		@DisplayName("목록_다음페이지면_리뷰수를생략한다")
		void list_nextPage_omitsTotalCount() throws Exception {
			when(reviewService.list(3L, "next")).thenReturn(new ReviewListResponse(null, List.of(), null));

			mockMvc.perform(list(3).param("cursor", "next"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.totalCount").doesNotExist())
					.andExpect(jsonPath("$.nextCursor").doesNotExist());
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
			when(reviewService.list(3L, null)).thenReturn(new ReviewListResponse(1,
					List.of(new ReviewItem(1L, OffsetDateTime.parse("2026-10-21T12:00:00+09:00"), "좋았어요")),
					"next"));

			JsonNode page = jsonMapper.readTree(mockMvc.perform(list(3)).andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString());

			assertThat(Set.copyOf(page.propertyNames())).isSubsetOf(LIST);
			page.get("items").forEach(item -> assertThat(Set.copyOf(item.propertyNames())).isSubsetOf(ITEM));
			assertThat(page.get("items").get(0).get("createdAt").asString()).isEqualTo("2026-10-21T12:00:00+09:00");
		}

		@Test
		@DisplayName("등록_응답키는_reviewId하나다")
		void create_responseKeys_reviewIdOnly() throws Exception {
			String body = mockMvc.perform(create(3, "{}")).andExpect(status().isCreated())
					.andReturn().getResponse().getContentAsString();

			assertThat(Set.copyOf(jsonMapper.readTree(body).propertyNames())).containsExactly("reviewId");
		}
	}

	@Nested
	@DisplayName("로그")
	@ExtendWith(OutputCaptureExtension.class)
	class Logging {

		@Test
		@DisplayName("등록_정상요청후_로그에본문과토큰이없다")
		void create_success_doesNotLogDescriptionOrToken(CapturedOutput output) throws Exception {
			mockMvc.perform(create(3, "{\"description\":\"" + LOG_SECRET + "\"}"))
					.andExpect(status().isCreated());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET).doesNotContain(TOKEN);
		}

		@Test
		@DisplayName("등록_인증실패로401이나도_로그에토큰이없다")
		void create_unauthorized_doesNotLogToken(CapturedOutput output) throws Exception {
			when(auth.authenticate(LOG_SECRET)).thenThrow(new AuthFailure("인증을 확인해주세요."));

			mockMvc.perform(createWithoutAuthorization(3, "{}").header("Authorization", "Bearer " + LOG_SECRET))
					.andExpect(status().isUnauthorized());

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
				Arguments.of("깨진 JSON", create(1, "{\"description\":\"" + LOG_SECRET + "\"")));
	}

	private void expectProblem(MockHttpServletRequestBuilder request, int status) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().is(status))
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(status))
				.andExpect(jsonPath("$.detail").isString());
	}

}
