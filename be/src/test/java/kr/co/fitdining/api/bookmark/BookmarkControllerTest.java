package kr.co.fitdining.api.bookmark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.bookmark.dto.BookmarkItem;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 북마크 API의 상태 코드, ProblemDetail, 인증 순서, 응답 JSON 키를 확인한다. 저장과 목록 계산은
 * {@code BookmarkPersistenceTest}가 실제 PostgreSQL로 확인하므로 여기서는 서비스와 인증 모듈을 대신한다.
 */
@org.springframework.test.context.TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = BookmarkController.class)
class BookmarkControllerTest {

	private static final String TOKEN = "valid-access-token";
	private static final String USER_ID = "user-1";
	private static final String BASE = "/api/v1/me/bookmarks";

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JsonMapper jsonMapper;

	@MockitoBean
	BookmarkService bookmarkService;

	@MockitoBean
	AuthUseCases auth;

	@BeforeEach
	void setUp() {
		when(auth.authenticate(TOKEN)).thenReturn(new AuthUseCases.Identity(USER_ID, null, null, 0, 0));
		when(auth.authenticate("invalid")).thenThrow(new AuthFailure("유효하지 않은 토큰입니다."));
		when(auth.authenticate("expired")).thenThrow(AuthFailure.accessExpired());
	}

	/** 네 API. 장소 id가 필요한 API는 3번 장소다. */
	enum Endpoint {
		LIST, STATUS, SAVE, REMOVE;

		MockHttpServletRequestBuilder request() {
			return request("3");
		}

		MockHttpServletRequestBuilder request(String placeId) {
			return switch (this) {
				case LIST -> get(BASE);
				case STATUS -> get(BASE + "/" + placeId);
				case SAVE -> put(BASE + "/" + placeId);
				case REMOVE -> delete(BASE + "/" + placeId);
			};
		}
	}

	static Stream<Endpoint> endpoints() {
		return Stream.of(Endpoint.values());
	}

	static Stream<Arguments> invalidPlaceIds() {
		return Stream.of(Endpoint.STATUS, Endpoint.SAVE, Endpoint.REMOVE).flatMap(endpoint ->
				Stream.of("abc", "0", "-1", "9223372036854775808", "1.5").map(id -> Arguments.of(endpoint, id)));
	}

	private static BookmarkItem item(long id, String address) {
		return new BookmarkItem(new PlaceSummary(id, "카페 온담", CategoryGroup.CAFE, Station.YEOKSAM, 37.5, 127.03,
				null), address, List.of("조용한 곳"), OpenStatus.OPEN, OffsetDateTime.parse("2026-10-29T12:00:00.123456+09:00"));
	}

	@Nested
	@DisplayName("인증")
	class Authentication {

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.bookmark.BookmarkControllerTest#endpoints")
		@DisplayName("인증_토큰이없으면_401ProblemDetail이고서비스를부르지않는다")
		void anyEndpoint_missingToken_returnsUnauthorized(Endpoint endpoint) throws Exception {
			mockMvc.perform(endpoint.request())
					.andExpect(status().isUnauthorized())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.status").value(401));
			verifyNoInteractions(bookmarkService);
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.bookmark.BookmarkControllerTest#endpoints")
		@DisplayName("인증_Bearer가아닌헤더나무효토큰이면_401이다")
		void anyEndpoint_invalidToken_returnsUnauthorized(Endpoint endpoint) throws Exception {
			mockMvc.perform(endpoint.request().header("Authorization", "Basic abc"))
					.andExpect(status().isUnauthorized());
			mockMvc.perform(endpoint.request().header("Authorization", "Bearer invalid"))
					.andExpect(status().isUnauthorized())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
			verifyNoInteractions(bookmarkService);
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.bookmark.BookmarkControllerTest#endpoints")
		@DisplayName("인증_만료토큰이면_401과토큰만료type이다")
		void anyEndpoint_expiredToken_returnsUnauthorizedWithExpiredType(Endpoint endpoint) throws Exception {
			mockMvc.perform(endpoint.request().header("Authorization", "Bearer expired"))
					.andExpect(status().isUnauthorized())
					.andExpect(jsonPath("$.type").value("urn:fitdining:auth:access-token-expired"));
		}

		@ParameterizedTest(name = "{0}")
		@MethodSource("kr.co.fitdining.api.bookmark.BookmarkControllerTest#endpoints")
		@DisplayName("인증_탈퇴한사용자면_서비스의401을ProblemDetail로돌려준다")
		void anyEndpoint_withdrawnUser_returnsUnauthorized(Endpoint endpoint) throws Exception {
			AuthFailure withdrawn = new AuthFailure("로그인이 필요합니다.");
			when(bookmarkService.list(anyString())).thenThrow(withdrawn);
			when(bookmarkService.isBookmarked(anyString(), anyLong())).thenThrow(withdrawn);
			doThrow(withdrawn).when(bookmarkService).save(anyString(), anyLong());
			doThrow(withdrawn).when(bookmarkService).remove(anyString(), anyLong());

			mockMvc.perform(endpoint.request().header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isUnauthorized())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("인증_쿼리나본문의userId는_무시하고토큰의사용자로처리한다")
		void saveAndList_userIdInQueryOrBody_usesTokenUser() throws Exception {
			mockMvc.perform(put(BASE + "/3").param("userId", "someone-else")
							.contentType(MediaType.APPLICATION_JSON).content("{\"userId\":\"someone-else\"}")
							.header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isNoContent());
			mockMvc.perform(get(BASE).param("userId", "someone-else").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isOk());

			verify(bookmarkService).save(USER_ID, 3);
			verify(bookmarkService).list(USER_ID);
		}

	}

	@Nested
	@DisplayName("장소 id")
	class PlaceIdValidation {

		@ParameterizedTest(name = "{0} {1}")
		@MethodSource("kr.co.fitdining.api.bookmark.BookmarkControllerTest#invalidPlaceIds")
		@DisplayName("placeIdEndpoints_invalidPlaceId_authenticationComesFirst")
        void placeIdEndpoints_invalidPlaceId_authenticationComesFirst(Endpoint endpoint, String placeId) throws Exception {
            mockMvc.perform(endpoint.request(placeId)).andExpect(status().isUnauthorized());
            mockMvc.perform(endpoint.request(placeId).header("Authorization", "Bearer expired"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.type").value(AuthFailure.ACCESS_TOKEN_EXPIRED.toString()));
            mockMvc.perform(endpoint.request(placeId).header("Authorization", "Bearer " + TOKEN))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
            verifyNoInteractions(bookmarkService);
        }

	}

	@Nested
	@DisplayName("저장과 해제")
	class Write {

		@Test
		@DisplayName("저장_성공하면_204이고본문이없다")
		void save_validToken_returnsNoContent() throws Exception {
			mockMvc.perform(put(BASE + "/3").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isNoContent())
					.andExpect(content().string(""));
			verify(bookmarkService).save(USER_ID, 3);
		}

		@Test
		@DisplayName("저장_없는장소면_404ProblemDetail이다")
		void save_missingPlace_returnsNotFound() throws Exception {
			doThrow(new PlaceNotFoundException()).when(bookmarkService).save(USER_ID, 9);

			mockMvc.perform(put(BASE + "/9").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isNotFound())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("저장_장소엔진이없으면_503ProblemDetail이다")
		void save_noEngine_returnsServiceUnavailable() throws Exception {
			doThrow(new PlaceSearchUnavailableException()).when(bookmarkService).save(USER_ID, 3);

			mockMvc.perform(put(BASE + "/3").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isServiceUnavailable())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("해제_204이고본문이없다")
		void remove_validToken_returnsNoContent() throws Exception {
			mockMvc.perform(delete(BASE + "/3").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isNoContent())
					.andExpect(content().string(""));
			verify(bookmarkService).remove(USER_ID, 3);
		}

		@Test
		@DisplayName("지원하지않는메서드면_Spring의405를그대로둔다")
		void post_unsupportedMethod_returnsMethodNotAllowed() throws Exception {
			mockMvc.perform(post(BASE + "/3").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isMethodNotAllowed());
		}

	}

	@Nested
	@DisplayName("조회")
	class Read {

		@Test
		@DisplayName("저장여부_bookmarked만담는다")
		void status_saved_returnsBookmarkedOnly() throws Exception {
			when(bookmarkService.isBookmarked(USER_ID, 3)).thenReturn(true);

			String body = mockMvc.perform(get(BASE + "/3").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isOk())
					.andReturn().getResponse().getContentAsString();

			assertThat(jsonMapper.readTree(body).toString()).isEqualTo("{\"bookmarked\":true}");
		}

		@Test
		@DisplayName("저장여부_저장하지않았으면_false다")
		void status_notSaved_returnsFalse() throws Exception {
			mockMvc.perform(get(BASE + "/4").header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.bookmarked").value(false));
		}

		@Test
		@DisplayName("목록_BookmarkItem키만담고null키는빠지며savedAt은KST오프셋이다")
		void list_items_returnsBookmarkItemKeysOnly() throws Exception {
			when(bookmarkService.list(USER_ID)).thenReturn(List.of(item(3, "서울 강남구 역삼로 1"), item(4, null)));

			String body = mockMvc.perform(get(BASE).header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isOk())
					.andExpect(content().contentType(MediaType.APPLICATION_JSON))
					.andReturn().getResponse().getContentAsString();

			JsonNode items = jsonMapper.readTree(body);
			assertThat(items.size()).isEqualTo(2);
			assertThat(items.get(0).propertyNames())
					.containsExactlyInAnyOrder("place", "address", "tags", "openStatus", "savedAt");
			assertThat(items.get(1).propertyNames())
					.containsExactlyInAnyOrder("place", "tags", "openStatus", "savedAt");
			assertThat(items.get(0).get("place").propertyNames())
					.containsExactlyInAnyOrder("id", "name", "categoryGroup", "station", "lat", "lng");
			assertThat(items.get(0).get("savedAt").asString()).isEqualTo("2026-10-29T12:00:00.123456+09:00");
		}

		@Test
		@DisplayName("목록_비어있으면_빈배열이다")
		void list_noBookmarks_returnsEmptyArray() throws Exception {
			when(bookmarkService.list(USER_ID)).thenReturn(List.of());

			mockMvc.perform(get(BASE).header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isOk())
					.andExpect(content().json("[]"));
		}

		@Test
		@DisplayName("목록_장소엔진이없으면_503ProblemDetail이다")
		void list_noEngine_returnsServiceUnavailable() throws Exception {
			when(bookmarkService.list(USER_ID)).thenThrow(new PlaceSearchUnavailableException());

			mockMvc.perform(get(BASE).header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isServiceUnavailable())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
		}

		@Test
		@DisplayName("목록_예상하지못한오류면_500ProblemDetail이고메시지를드러내지않는다")
		void list_unexpectedFailure_returnsInternalError() throws Exception {
			when(bookmarkService.list(USER_ID)).thenThrow(new IllegalStateException("secret internal detail"));

			mockMvc.perform(get(BASE).header("Authorization", "Bearer " + TOKEN))
					.andExpect(status().isInternalServerError())
					.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
					.andExpect(jsonPath("$.detail").value("잠시 후 다시 시도해 주세요."));
		}

	}

}
