package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.dto.TagView;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;
import kr.co.fitdining.api.review.exception.InvalidVisitDateException;
import kr.co.fitdining.api.review.store.InvalidReviewCursorException;
import kr.co.fitdining.api.review.tag.ReasonTag;
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

	/** 필수 필드만 채운 본문에 {@code extra}(앞에 쉼표를 붙인 JSON 속성)를 더한다. */
	private static String valid(String extra) {
		return "{\"visitedAt\":\"2026-10-21\",\"tagCodes\":[\"QUIET_GOOD\"],\"revisitIntent\":false" + extra + "}";
	}

	private static final String VALID = valid("");

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
			mockMvc.perform(create(3, "{\"visitedAt\":\"2026-10-18\",\"tagCodes\":[\"QUIET_GOOD\",\"SHORT_WAIT_BAD\"],"
							+ "\"revisitIntent\":true,\"description\":\"분위기가 좋았어요\",\"spentPerPerson\":15000}"))
					.andExpect(status().isCreated())
					.andExpect(content().contentType(MediaType.APPLICATION_JSON))
					.andExpect(jsonPath("$.reviewId").value(7));

			verify(reviewService).create(3L, USER_ID, new ReviewCreateRequest(LocalDate.of(2026, 10, 18),
					List.of("QUIET_GOOD", "SHORT_WAIT_BAD"), true, "분위기가 좋았어요", 15000));
		}

		@Test
		@DisplayName("등록_본문과금액없이도_201이다")
		void create_withoutOptionalFields_returnsCreated() throws Exception {
			mockMvc.perform(create(3, VALID)).andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_본문이500자면_201이다")
		void create_description500_returnsCreated() throws Exception {
			mockMvc.perform(create(3, valid(",\"description\":\"" + "가".repeat(500) + "\"")))
					.andExpect(status().isCreated());
		}

		@Test
		@DisplayName("등록_본문이501자면_400이다")
		void create_description501_returnsBadRequest() throws Exception {
			expectProblem(create(3, valid(",\"description\":\"" + "가".repeat(501) + "\"")), 400);
		}

		@ParameterizedTest
		@ValueSource(ints = {0, 1_000_000})
		@DisplayName("등록_1인당금액이0원이나1000000원이면_201이다")
		void create_spentPerPersonBoundary_returnsCreated(int spent) throws Exception {
			mockMvc.perform(create(3, valid(",\"spentPerPerson\":" + spent))).andExpect(status().isCreated());
		}

		@ParameterizedTest
		@ValueSource(ints = {-1, 1_000_001})
		@DisplayName("등록_1인당금액이범위밖이면_400이고저장하지않는다")
		void create_spentPerPersonOutOfRange_returnsBadRequest(int spent) throws Exception {
			expectProblem(create(3, valid(",\"spentPerPerson\":" + spent)), 400);

			verify(reviewService, never()).create(anyLong(), anyString(), any());
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"{}",
				"{\"tagCodes\":[\"QUIET_GOOD\"],\"revisitIntent\":false}",
				"{\"visitedAt\":\"2026-10-21\",\"revisitIntent\":false}",
				"{\"visitedAt\":\"2026-10-21\",\"tagCodes\":[],\"revisitIntent\":false}",
				"{\"visitedAt\":\"2026-10-21\",\"tagCodes\":[\"QUIET_GOOD\"]}"
		})
		@DisplayName("등록_방문일태그재방문의사중하나라도없으면_400이고저장하지않는다")
		void create_missingRequiredField_returnsBadRequest(String body) throws Exception {
			expectProblem(create(3, body), 400);

			verify(reviewService, never()).create(anyLong(), anyString(), any());
		}

		@Test
		@DisplayName("등록_같은장소에같은방문일로이미썼으면_409다")
		void create_duplicateVisit_returnsConflict() throws Exception {
			when(reviewService.create(anyLong(), anyString(), any())).thenThrow(new DuplicateReviewException());

			expectProblem(create(3, VALID), 409);
		}

		@Test
		@DisplayName("등록_이유태그가선택규칙에맞지않으면_400이다")
		void create_invalidReasonTags_returnsBadRequest() throws Exception {
			when(reviewService.create(anyLong(), anyString(), any())).thenThrow(new InvalidReasonTagsException());

			expectProblem(create(3, VALID), 400);
		}

		@Test
		@DisplayName("등록_방문일이범위밖이면_400이다")
		void create_invalidVisitDate_returnsBadRequest() throws Exception {
			when(reviewService.create(anyLong(), anyString(), any())).thenThrow(new InvalidVisitDateException());

			expectProblem(create(3, VALID), 400);
		}
	}

	@Nested
	@DisplayName("인증")
	class Authentication {

		@Test
		@DisplayName("등록_Authorization헤더가없으면_본문이비어도400이아니라401이고저장하지않는다")
		void create_noAuthorization_returnsUnauthorizedBeforeValidation() throws Exception {
			expectProblem(createWithoutAuthorization(3, "{}"), 401);
			expectProblem(createWithoutAuthorization(3, VALID), 401);

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
			when(reviewService.list(3L, null, null)).thenReturn(new ReviewListResponse(0, List.of(), null));

			mockMvc.perform(list(3)).andExpect(status().isOk()).andExpect(jsonPath("$.totalCount").value(0));
		}

		@Test
		@DisplayName("목록_로그인했으면_조회한사용자를넘긴다")
		void list_loggedIn_passesViewer() throws Exception {
			when(reviewService.list(3L, null, USER_ID)).thenReturn(new ReviewListResponse(0, List.of(), null));

			mockMvc.perform(list(3).header("Authorization", "Bearer " + TOKEN)).andExpect(status().isOk());

			verify(reviewService).list(3L, null, USER_ID);
		}

		@Test
		@DisplayName("목록_헤더가있는데토큰이유효하지않으면_401이고조회하지않는다")
		void list_invalidToken_returnsUnauthorized() throws Exception {
			when(auth.authenticate("forged")).thenThrow(new AuthFailure("인증을 확인해주세요."));

			expectProblem(list(3).header("Authorization", "Bearer forged"), 401);
			expectProblem(list(3).header("Authorization", "Basic " + TOKEN), 401);
			verify(reviewService, never()).list(anyLong(), any(), any());
		}
	}

	@Nested
	@DisplayName("작성 화면 데이터")
	class ReviewForm {

		private MockHttpServletRequestBuilder form(Object placeId) {
			return get("/api/v1/places/{placeId}/review-form", placeId).header("Authorization", "Bearer " + TOKEN);
		}

		@Test
		@DisplayName("작성화면_로그인했으면_작성자기준데이터를돌려준다")
		void reviewForm_loggedIn_returnsForm() throws Exception {
			LocalDate today = LocalDate.of(2026, 10, 21);
			when(reviewService.reviewForm(3L, USER_ID)).thenReturn(new ReviewFormResponse(
					new ReviewFormResponse.Place("카페 온담", CategoryGroup.CAFE, Station.YEOKSAM, null, 37.5, 127.03),
					new ReviewFormResponse.VisitDate(today.minusMonths(1), today, today), List.of(today),
					new ReviewFormResponse.Tags(
							List.of(new ReviewFormResponse.FormTag("QUIET_GOOD", "조용해서 좋았어요", "NOISE", "분위기")),
							List.of()),
					ReviewService.LIMITS, true));

			mockMvc.perform(form(3))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.place.categoryGroup").value("CAFE"))
					.andExpect(jsonPath("$.place.thumbnailUrl").doesNotExist())
					.andExpect(jsonPath("$.place.lat").value(37.5))
					.andExpect(jsonPath("$.place.lng").value(127.03))
					.andExpect(jsonPath("$.visitDate.default").value("2026-10-21"))
					.andExpect(jsonPath("$.visitDate.min").value("2026-09-21"))
					.andExpect(jsonPath("$.reviewedDates[0]").value("2026-10-21"))
					.andExpect(jsonPath("$.tags.good[0].group").value("NOISE"))
					.andExpect(jsonPath("$.limits.descriptionMax").value(500))
					.andExpect(jsonPath("$.writable").value(true));
		}

		@Test
		@DisplayName("작성화면_로그인하지않으면_401이다")
		void reviewForm_noAuthorization_returnsUnauthorized() throws Exception {
			expectProblem(get("/api/v1/places/{placeId}/review-form", 3), 401);
		}

		@Test
		@DisplayName("작성화면과등록_없는장소면_404다")
		void placeNotFound_returnsNotFound() throws Exception {
			when(reviewService.reviewForm(anyLong(), anyString())).thenThrow(new PlaceNotFoundException());
			when(reviewService.create(anyLong(), anyString(), any())).thenThrow(new PlaceNotFoundException());
			when(reviewService.list(anyLong(), any(), any())).thenThrow(new PlaceNotFoundException());

			expectProblem(form(999), 404);
			expectProblem(create(999, VALID), 404);
			expectProblem(list(999), 404);
		}

		@Test
		@DisplayName("작성화면_장소검색을쓸수없으면_503이다")
		void placeUnavailable_returnsServiceUnavailable() throws Exception {
			when(reviewService.reviewForm(anyLong(), anyString())).thenThrow(new PlaceSearchUnavailableException());

			expectProblem(form(3), 503);
		}
	}

	@Nested
	@DisplayName("요청 본문 검증")
	class RequestBodyValidation {

		@ParameterizedTest
		@ValueSource(strings = {
				"{\"description\":\"좋았어요\",\"userId\":1}",
				"{\"visitedAt\":\"2026-10-21\",\"tagCodes\":[\"QUIET_GOOD\"],\"revisitIntent\":false,\"createdAt\":1}"
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
			when(reviewService.list(eq(3L), anyString(), isNull())).thenThrow(new InvalidReviewCursorException());

			expectProblem(list(3).param("cursor", "not-a-cursor!"), 400);
		}

		@Test
		@DisplayName("목록_다음페이지면_리뷰수를생략한다")
		void list_nextPage_omitsTotalCount() throws Exception {
			when(reviewService.list(3L, "next", null)).thenReturn(new ReviewListResponse(null, List.of(), null));

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
		private static final Set<String> ITEM = Set.of("reviewId", "createdAt", "visitedAt", "nickname",
				"revisitIntent", "tags", "description", "mine");
		private static final Set<String> TAG = Set.of("code", "label", "sentiment");

		@Test
		@DisplayName("목록_응답키는_문서화된필드를벗어나지않는다")
		void list_responseKeys_documentedOnly() throws Exception {
			when(reviewService.list(3L, null, null)).thenReturn(new ReviewListResponse(1,
					List.of(new ReviewItem(1L, OffsetDateTime.parse("2026-10-21T12:00:00+09:00"), LocalDate.of(2026, 10, 20),
							"밤산책", true, List.of(new TagView("QUIET_GOOD", "조용해서 좋았어요", ReasonTag.Sentiment.GOOD)),
							"좋았어요", false)),
					"next"));

			JsonNode page = jsonMapper.readTree(mockMvc.perform(list(3)).andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString());

			assertThat(Set.copyOf(page.propertyNames())).isSubsetOf(LIST);
			page.get("items").forEach(item -> assertThat(Set.copyOf(item.propertyNames())).isEqualTo(ITEM));
			JsonNode item = page.get("items").get(0);
			assertThat(Set.copyOf(item.get("tags").get(0).propertyNames())).isEqualTo(TAG);
			assertThat(item.get("createdAt").asString()).isEqualTo("2026-10-21T12:00:00+09:00");
			assertThat(item.get("visitedAt").asString()).isEqualTo("2026-10-20");
			assertThat(item.get("tags").get(0).get("sentiment").asString()).isEqualTo("GOOD");
		}

		@Test
		@DisplayName("등록_응답키는_reviewId하나다")
		void create_responseKeys_reviewIdOnly() throws Exception {
			String body = mockMvc.perform(create(3, VALID)).andExpect(status().isCreated())
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
			mockMvc.perform(create(3, valid(",\"description\":\"" + LOG_SECRET + "\"")))
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
				Arguments.of("501자 본문", create(1, valid(",\"description\":\"" + LOG_SECRET + "가".repeat(501) + "\""))),
				Arguments.of("범위 밖 금액과 본문", create(1, valid(",\"description\":\"" + LOG_SECRET
						+ "\",\"spentPerPerson\":1000001"))),
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
