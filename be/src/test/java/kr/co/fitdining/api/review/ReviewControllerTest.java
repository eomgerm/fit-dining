package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
import kr.co.fitdining.api.review.dto.ReviewDetailResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.dto.ReviewReportRequest;
import kr.co.fitdining.api.review.dto.ReviewUpdateRequest;
import kr.co.fitdining.api.review.dto.TagView;
import kr.co.fitdining.api.review.exception.DuplicateReportException;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.exception.InvalidReasonTagsException;
import kr.co.fitdining.api.review.exception.InvalidVisitDateException;
import kr.co.fitdining.api.review.exception.OwnReviewReportException;
import kr.co.fitdining.api.review.exception.ReviewForbiddenException;
import kr.co.fitdining.api.review.exception.ReviewNotFoundException;
import kr.co.fitdining.api.review.report.ReportReason;
import kr.co.fitdining.api.review.store.InvalidReviewCursorException;
import kr.co.fitdining.api.review.tag.ReasonTag;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
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

	/** 본인 리뷰만 다루는 세 엔드포인트. 인증·권한·형식 시험을 엔드포인트마다 한 번씩 돌린다. */
	enum OwnEndpoint {
		DETAIL {
			@Override
			MockHttpServletRequestBuilder request(Object reviewId) {
				return get("/api/v1/reviews/{reviewId}", reviewId);
			}

			@Override
			void failWith(ReviewService service, long reviewId, RuntimeException failure) {
				when(service.detail(reviewId, USER_ID)).thenThrow(failure);
			}
		},
		UPDATE {
			@Override
			MockHttpServletRequestBuilder request(Object reviewId) {
				return patch("/api/v1/reviews/{reviewId}", reviewId).contentType(MediaType.APPLICATION_JSON)
						.content("{\"description\":\"본문\"}");
			}

			@Override
			void failWith(ReviewService service, long reviewId, RuntimeException failure) {
				doThrow(failure).when(service).update(eq(reviewId), eq(USER_ID), any());
			}
		},
		DELETE {
			@Override
			MockHttpServletRequestBuilder request(Object reviewId) {
				return delete("/api/v1/reviews/{reviewId}", reviewId);
			}

			@Override
			void failWith(ReviewService service, long reviewId, RuntimeException failure) {
				doThrow(failure).when(service).delete(reviewId, USER_ID);
			}
		};

		/** 토큰 없는 요청 */
		abstract MockHttpServletRequestBuilder request(Object reviewId);

		abstract void failWith(ReviewService service, long reviewId, RuntimeException failure);
	}

	@Nested
	@DisplayName("내 리뷰 조회·수정·삭제")
	class OwnReview {

		@Test
		@DisplayName("조회_내리뷰면_수정화면필드만돌려준다")
		void detail_own_returnsEditableFieldsOnly() throws Exception {
			when(reviewService.detail(7L, USER_ID)).thenReturn(new ReviewDetailResponse(7L, 3L, "고칠 본문",
					new ReviewDetailResponse.Limits(500, 5)));

			String body = mockMvc.perform(withToken(get("/api/v1/reviews/{reviewId}", 7)))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.placeId").value(3))
					.andExpect(jsonPath("$.description").value("고칠 본문"))
					.andExpect(jsonPath("$.limits.descriptionMax").value(500))
					.andExpect(jsonPath("$.limits.photoMax").value(5))
					.andReturn().getResponse().getContentAsString();

			assertThat(Set.copyOf(jsonMapper.readTree(body).propertyNames()))
					.isEqualTo(Set.of("reviewId", "placeId", "description", "limits"));
		}

		@Test
		@DisplayName("조회_본문없는리뷰면_description키를생략한다")
		void detail_noDescription_omitsDescription() throws Exception {
			when(reviewService.detail(7L, USER_ID)).thenReturn(new ReviewDetailResponse(7L, 3L, null,
					new ReviewDetailResponse.Limits(500, 5)));

			String body = mockMvc.perform(withToken(get("/api/v1/reviews/{reviewId}", 7)))
					.andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString();

			assertThat(Set.copyOf(jsonMapper.readTree(body).propertyNames()))
					.isEqualTo(Set.of("reviewId", "placeId", "limits"));
		}

		@Test
		@DisplayName("수정_500자본문이면_204이고작성자와함께넘긴다")
		void update_maxLengthDescription_returnsNoContent() throws Exception {
			mockMvc.perform(update(7, "{\"description\":\"" + "가".repeat(500) + "\"}"))
					.andExpect(status().isNoContent());

			verify(reviewService).update(7L, USER_ID, new ReviewUpdateRequest("가".repeat(500)));
		}

		@ParameterizedTest
		@ValueSource(strings = {"{}", "{\"description\":null}", "{\"visitedAt\":\"2026-10-21\"}",
				"{\"description\":\"본문\",\"tagCodes\":[\"QUIET_GOOD\"]}", "{\"description\":\"본문\",\"revisitIntent\":true}",
				"{\"description\":\"본문\",\"spentPerPerson\":1}", "{\"description\":\"본문\",\"userId\":\"user-2\"}"})
		@DisplayName("수정_고칠필드가없거나다른필드가있으면_400이고고치지않는다")
		void update_noFieldOrOtherField_returnsBadRequest(String body) throws Exception {
			expectProblem(update(7, body), 400);

			verify(reviewService, never()).update(anyLong(), anyString(), any());
		}

		@Test
		@DisplayName("수정_본문이500자를넘으면_400이다")
		void update_tooLongDescription_returnsBadRequest() throws Exception {
			expectProblem(update(7, "{\"description\":\"" + "가".repeat(501) + "\"}"), 400);
		}

		@Test
		@DisplayName("삭제_내리뷰면_204다")
		void delete_own_returnsNoContent() throws Exception {
			mockMvc.perform(withToken(delete("/api/v1/reviews/{reviewId}", 7))).andExpect(status().isNoContent());

			verify(reviewService).delete(7L, USER_ID);
		}

		@ParameterizedTest
		@EnumSource(OwnEndpoint.class)
		@DisplayName("조회수정삭제_Authorization헤더가없으면_401이고처리하지않는다")
		void ownEndpoint_noAuthorization_returnsUnauthorized(OwnEndpoint endpoint) throws Exception {
			expectProblem(endpoint.request(7), 401);

			verify(reviewService, never()).detail(anyLong(), anyString());
			verify(reviewService, never()).update(anyLong(), anyString(), any());
			verify(reviewService, never()).delete(anyLong(), anyString());
		}

		@ParameterizedTest
		@EnumSource(OwnEndpoint.class)
		@DisplayName("조회수정삭제_남의리뷰면_403이다")
		void ownEndpoint_othersReview_returnsForbidden(OwnEndpoint endpoint) throws Exception {
			endpoint.failWith(reviewService, 8L, new ReviewForbiddenException());

			expectProblem(withToken(endpoint.request(8)), 403);
		}

		@ParameterizedTest
		@EnumSource(OwnEndpoint.class)
		@DisplayName("조회수정삭제_없거나삭제한리뷰면_404다")
		void ownEndpoint_missingReview_returnsNotFound(OwnEndpoint endpoint) throws Exception {
			endpoint.failWith(reviewService, 9L, new ReviewNotFoundException());

			expectProblem(withToken(endpoint.request(9)), 404);
		}

		@ParameterizedTest(name = "{0} {1}")
		@MethodSource("kr.co.fitdining.api.review.ReviewControllerTest#invalidReviewIds")
		@DisplayName("조회수정삭제_reviewId가양의정수가아니면_400이다")
		void ownEndpoint_invalidReviewId_returnsBadRequest(OwnEndpoint endpoint, String reviewId) throws Exception {
			expectProblem(withToken(endpoint.request(reviewId)), 400);
		}
	}

	static Stream<Arguments> invalidReviewIds() {
		return Stream.of(OwnEndpoint.values()).flatMap(endpoint -> Stream.of("0", "-1", "abc", "9223372036854775808")
				.map(reviewId -> Arguments.of(endpoint, reviewId)));
	}

	private static MockHttpServletRequestBuilder withToken(MockHttpServletRequestBuilder request) {
		return request.header("Authorization", "Bearer " + TOKEN);
	}

	private static MockHttpServletRequestBuilder update(Object reviewId, String body) {
		return withToken(patch("/api/v1/reviews/{reviewId}", reviewId).contentType(MediaType.APPLICATION_JSON)
				.content(body));
	}

	private static MockHttpServletRequestBuilder report(Object reviewId, String body) {
		return withToken(post("/api/v1/reviews/{reviewId}/reports", reviewId).contentType(MediaType.APPLICATION_JSON)
				.content(body));
	}

	@Nested
	@DisplayName("신고")
	class Report {

		@Test
		@DisplayName("신고_사유를고르면_201이고신고자와함께넘긴다")
		void report_reason_returnsCreated() throws Exception {
			mockMvc.perform(report(7, "{\"reason\":\"AD_SPAM\"}"))
					.andExpect(status().isCreated())
					.andExpect(content().string(""));

			verify(reviewService).report(7L, USER_ID, new ReviewReportRequest(ReportReason.AD_SPAM, null));
		}

		@Test
		@DisplayName("신고_기타에100자설명이면_201이다")
		void report_otherWithMaxDetail_returnsCreated() throws Exception {
			mockMvc.perform(report(7, "{\"reason\":\"OTHER\",\"detail\":\"" + "가".repeat(100) + "\"}"))
					.andExpect(status().isCreated());

			verify(reviewService).report(7L, USER_ID, new ReviewReportRequest(ReportReason.OTHER, "가".repeat(100)));
		}

		@Test
		@DisplayName("신고_설명이100자를넘으면_400이고신고하지않는다")
		void report_tooLongDetail_returnsBadRequest() throws Exception {
			expectProblem(report(7, "{\"reason\":\"OTHER\",\"detail\":\"" + "가".repeat(101) + "\"}"), 400);

			verify(reviewService, never()).report(anyLong(), anyString(), any());
		}

		@ParameterizedTest
		@EnumSource(value = ReportReason.class, names = "OTHER", mode = EnumSource.Mode.EXCLUDE)
		@DisplayName("신고_기타가아닌사유에설명이있으면_400이다")
		void report_detailWithoutOther_returnsBadRequest(ReportReason reason) throws Exception {
			expectProblem(report(7, "{\"reason\":\"" + reason + "\",\"detail\":\"설명\"}"), 400);

			verify(reviewService, never()).report(anyLong(), anyString(), any());
		}

		@Test
		@DisplayName("신고_기타가아닌사유에공백설명이면_설명없음으로보고201이다")
		void report_blankDetailWithoutOther_returnsCreated() throws Exception {
			mockMvc.perform(report(7, "{\"reason\":\"ABUSE\",\"detail\":\" \"}")).andExpect(status().isCreated());
		}

		@ParameterizedTest
		@ValueSource(strings = {"{}", "{\"reason\":null}", "{\"detail\":\"설명\"}"})
		@DisplayName("신고_사유가없으면_400이다")
		void report_missingReason_returnsBadRequest(String body) throws Exception {
			expectProblem(report(7, body), 400);
		}

		@ParameterizedTest
		@ValueSource(strings = {"{\"reason\":\"SPAM\"}", "{\"reason\":\"AD_SPAM\",\"reviewId\":1}",
				"{\"reason\":\"AD_SPAM\",\"detailAllowed\":true}"})
		@DisplayName("신고_모르는사유나정의되지않은속성이면_400이다")
		void report_unknownReasonOrProperty_returnsBadRequest(String body) throws Exception {
			expectProblem(report(7, body), 400);
		}

		@Test
		@DisplayName("신고_Authorization헤더가없으면_본문검증전에401이다")
		void report_noAuthorization_returnsUnauthorizedBeforeValidation() throws Exception {
			expectProblem(post("/api/v1/reviews/{reviewId}/reports", 7).contentType(MediaType.APPLICATION_JSON)
					.content("{}"), 401);

			verify(reviewService, never()).report(anyLong(), anyString(), any());
		}

		@Test
		@DisplayName("신고_내리뷰면_400이다")
		void report_ownReview_returnsBadRequest() throws Exception {
			doThrow(new OwnReviewReportException()).when(reviewService).report(eq(7L), eq(USER_ID), any());

			expectProblem(report(7, "{\"reason\":\"AD_SPAM\"}"), 400);
		}

		@Test
		@DisplayName("신고_이미신고했으면_409다")
		void report_alreadyReported_returnsConflict() throws Exception {
			doThrow(new DuplicateReportException()).when(reviewService).report(eq(7L), eq(USER_ID), any());

			expectProblem(report(7, "{\"reason\":\"AD_SPAM\"}"), 409);
		}

		@Test
		@DisplayName("신고_없거나삭제한리뷰면_404다")
		void report_missingReview_returnsNotFound() throws Exception {
			doThrow(new ReviewNotFoundException()).when(reviewService).report(eq(9L), eq(USER_ID), any());

			expectProblem(report(9, "{\"reason\":\"AD_SPAM\"}"), 404);
		}

		@ParameterizedTest
		@ValueSource(strings = {"0", "-1", "abc", "9223372036854775808"})
		@DisplayName("신고_reviewId가양의정수가아니면_400이다")
		void report_invalidReviewId_returnsBadRequest(String reviewId) throws Exception {
			expectProblem(report(reviewId, "{\"reason\":\"AD_SPAM\"}"), 400);
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
		@DisplayName("수정_정상요청후_로그에본문과토큰이없다")
		void update_success_doesNotLogDescriptionOrToken(CapturedOutput output) throws Exception {
			mockMvc.perform(update(7, "{\"description\":\"" + LOG_SECRET + "\"}")).andExpect(status().isNoContent());

			assertThat(output.getAll()).doesNotContain(LOG_SECRET).doesNotContain(TOKEN);
		}

		@Test
		@DisplayName("신고_정상요청후_로그에설명과토큰이없다")
		void report_success_doesNotLogDetailOrToken(CapturedOutput output) throws Exception {
			mockMvc.perform(report(7, "{\"reason\":\"OTHER\",\"detail\":\"" + LOG_SECRET + "\"}"))
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
		@DisplayName("등록수정신고_잘못된요청으로400이나도_로그에입력값이없다")
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
				Arguments.of("깨진 JSON", create(1, "{\"description\":\"" + LOG_SECRET + "\"")),
				Arguments.of("수정 501자 본문", update(7, "{\"description\":\"" + LOG_SECRET + "가".repeat(501) + "\"}")),
				Arguments.of("수정 다른 필드", update(7, "{\"description\":\"" + LOG_SECRET + "\",\"spentPerPerson\":1}")),
				Arguments.of("신고 101자 설명", report(7, "{\"reason\":\"OTHER\",\"detail\":\"" + LOG_SECRET
						+ "가".repeat(101) + "\"}")),
				Arguments.of("신고 기타가 아닌 사유의 설명", report(7, "{\"reason\":\"ABUSE\",\"detail\":\"" + LOG_SECRET
						+ "\"}")));
	}

	private void expectProblem(MockHttpServletRequestBuilder request, int status) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().is(status))
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(status))
				.andExpect(jsonPath("$.detail").isString());
	}

}
