package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.FitKind;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.domain.ResultGroup;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupResult;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.TooManyMeetupWritesException;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.exception.MeetupResultNotFoundException;
import kr.co.fitdining.api.meetup.recommend.MeetupRanking;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.support.SessionTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 모임 API의 요청 검증, 인증, 오류 응답, 응답 헤더를 확인한다. 저장과 상태 계산은 {@code MeetupPersistenceTest}가 실제
 * PostgreSQL로 확인하므로 여기서는 서비스를 대신한다.
 */
@TestPropertySource(properties = {"auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@WebMvcTest(controllers = MeetupController.class)
class MeetupControllerTest {

	private static final String USER_ID = "user-1";
	private static final String CODE = "AbCdEfGhIjKlMnOpQrStUv";
	private static final String LOG_SECRET = "로그에남으면안되는모임설명";

	@Autowired
	MockMvc mockMvc;

	@MockitoBean
	MeetupService meetupService;

	@MockitoBean
	MeetupProfileService profileService;

	@MockitoBean
	MeetupCalculationService calculationService;

	@MockitoBean
	MeetupResultService resultService;

	@MockitoBean
	MeetupWriteLimiter writeLimiter;

	@MockitoBean
	AuthUseCases auth;

	@BeforeEach
	void setUp() {
		when(meetupService.create(anyString(), any())).thenReturn(
				new MeetupCreateResponse(CODE, new MeetupQuestions(true, true, true, false)));
	}

	private static MockHttpServletRequestBuilder create(String body) {
		return post("/api/v1/meetups").with(SessionTestSupport.csrf()).with(SessionTestSupport.session(USER_ID))
				.contentType(MediaType.APPLICATION_JSON).content(body);
	}

	/** 지역만 채운 본문에 {@code extra}(앞에 쉼표를 붙인 JSON 속성)를 더한다. */
	private static String valid(String extra) {
		return "{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"}" + extra + "}";
	}

	private void expectProblem(MockHttpServletRequestBuilder request, int status) throws Exception {
		mockMvc.perform(request)
				.andExpect(status().is(status))
				.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.status").value(status))
				.andExpect(jsonPath("$.detail").isString());
	}

	@Nested
	@DisplayName("만들기")
	class Create {

		@Test
		@DisplayName("만들기_모든항목이있으면_201과코드와질문을받는다")
		void create_fullRequest_returnsCodeAndQuestions() throws Exception {
			mockMvc.perform(create(valid(",\"category\":\"BAR\",\"date\":\"2026-11-14\",\"time\":\"19:00\","
							+ "\"headcount\":4,\"description\":\"회식\"")))
					.andExpect(status().isCreated())
					.andExpect(header().string("Cache-Control", "no-store"))
					.andExpect(jsonPath("$.code").value(CODE))
					.andExpect(jsonPath("$.questions.food").value(true))
					.andExpect(jsonPath("$.questions.price").value(false));

			verify(meetupService).create(USER_ID, new MeetupCreateRequest(
					new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.BAR,
					LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), 4, "회식"));
		}

		@Test
		@DisplayName("만들기_지역만있어도_201이다")
		void create_areaOnly_returnsCreated() throws Exception {
			mockMvc.perform(create(valid(""))).andExpect(status().isCreated());
		}

		@Test
		@DisplayName("만들기_로그인하지않으면_401이다")
		void create_anonymous_returnsUnauthorized() throws Exception {
			expectProblem(post("/api/v1/meetups").with(SessionTestSupport.csrf())
					.contentType(MediaType.APPLICATION_JSON).content(valid("")), 401);
			verify(meetupService, never()).create(anyString(), any());
		}

		@Test
		@DisplayName("만들기_CSRF토큰이없으면_403이다")
		void create_withoutCsrf_returnsForbidden() throws Exception {
			expectProblem(post("/api/v1/meetups").with(SessionTestSupport.session(USER_ID))
					.contentType(MediaType.APPLICATION_JSON).content(valid("")), 403);
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"{}",
				"{\"area\":{\"name\":\"선릉\"}}",
				"{\"area\":{\"kind\":\"CITY\",\"name\":\"선릉\"}}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"category\":\"PUB\"}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"headcount\":1}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"headcount\":9}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"date\":\"11월 14일\"}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"time\":\"저녁\"}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\"},\"hostName\":\"민재\"}",
				"{\"area\":{\"kind\":\"STATION\",\"name\":\"선릉\",\"lat\":37.5}}"
		})
		@DisplayName("만들기_형식이틀리거나모르는속성이있으면_400이다")
		void create_invalidShape_returnsBadRequest(String body) throws Exception {
			expectProblem(create(body), 400);
			verify(meetupService, never()).create(anyString(), any());
		}

		@Test
		@DisplayName("만들기_서비스가받을수없는값이라고하면_400이다")
		void create_serviceRejects_returnsBadRequest() throws Exception {
			when(meetupService.create(anyString(), any())).thenThrow(new InvalidMeetupException());
			expectProblem(create(valid(",\"date\":\"2020-01-01\"")), 400);
		}

	}

	@Nested
	@DisplayName("지역 찾기")
	class Areas {

		@Test
		@DisplayName("지역찾기_찾는말이있으면_역과동을받는다")
		void areas_query_returnsItems() throws Exception {
			when(meetupService.areas(USER_ID, "선릉")).thenReturn(new MeetupAreasResponse(
					List.of(new MeetupAreasResponse.Item(AreaKind.STATION, "선릉"))));

			mockMvc.perform(get("/api/v1/meetups/areas").param("q", " 선릉 ").with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.items[0].kind").value("STATION"))
					.andExpect(jsonPath("$.items[0].name").value("선릉"));
		}

		@Test
		@DisplayName("지역찾기_로그인하지않으면_401이다")
		void areas_anonymous_returnsUnauthorized() throws Exception {
			expectProblem(get("/api/v1/meetups/areas").param("q", "선릉"), 401);
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "   ", "가나다라마바사아자차카타파하가나다라마바사"})
		@DisplayName("지역찾기_찾는말이비었거나20자를넘으면_400이다")
		void areas_invalidQuery_returnsBadRequest(String query) throws Exception {
			expectProblem(get("/api/v1/meetups/areas").param("q", query).with(SessionTestSupport.session(USER_ID)), 400);
		}

		@Test
		@DisplayName("지역찾기_찾는말이없으면_400이다")
		void areas_missingQuery_returnsBadRequest() throws Exception {
			expectProblem(get("/api/v1/meetups/areas").with(SessionTestSupport.session(USER_ID)), 400);
		}

	}

	@Nested
	@DisplayName("스냅숏")
	class Snapshot {

		private final MeetupSnapshot waiting = new MeetupSnapshot(MeetupPhase.WAITING, false,
				new MeetupSnapshot.Info(new MeetupSnapshot.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT,
						null, null, null, null, "민재", LocalDate.of(2026, 11, 18)),
				new MeetupQuestions(true, true, true, false),
				new MeetupSnapshot.Me(MeetupRole.VIEWER, null, false, null, null), List.of(MeetupAction.JOIN),
				List.of(), null, null, null);

		@Test
		@DisplayName("스냅숏_로그인없이도_200이고값없는속성은빠진다")
		void snapshot_anonymous_returnsWithoutNullFields() throws Exception {
			when(meetupService.snapshot(eq(CODE), isNull(), isNull())).thenReturn(waiting);

			mockMvc.perform(get("/api/v1/meetups/{code}", CODE))
					.andExpect(status().isOk())
					.andExpect(header().string("Cache-Control", "no-store"))
					.andExpect(jsonPath("$.phase").value("WAITING"))
					.andExpect(jsonPath("$.info.hostNickname").value("민재"))
					.andExpect(jsonPath("$.info.expiresOn").value("2026-11-18"))
					.andExpect(jsonPath("$.info.date").doesNotExist())
					.andExpect(jsonPath("$.info.headcount").doesNotExist())
					.andExpect(jsonPath("$.me.profileId").doesNotExist())
					.andExpect(jsonPath("$.allowed[0]").value("JOIN"))
					.andExpect(jsonPath("$.profiles").isArray());
		}

		@Test
		@DisplayName("스냅숏_비회원이열어도_로그인세션을만들지않는다")
		void snapshot_anonymous_createsNoSession() throws Exception {
			when(meetupService.snapshot(eq(CODE), isNull(), isNull())).thenReturn(waiting);

			var result = mockMvc.perform(get("/api/v1/meetups/{code}", CODE)).andExpect(status().isOk()).andReturn();

			assertThat(result.getRequest().getSession(false)).isNull();
			assertThat(result.getResponse().getHeaders("Set-Cookie"))
					.noneMatch(cookie -> cookie.startsWith("fitdining_session="));
		}

		@Test
		@DisplayName("스냅숏_로그인했으면_회원id로묻는다")
		void snapshot_signedIn_passesUserId() throws Exception {
			when(meetupService.snapshot(CODE, USER_ID, null)).thenReturn(waiting);

			mockMvc.perform(get("/api/v1/meetups/{code}", CODE).with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isOk());
			verify(meetupService).snapshot(CODE, USER_ID, null);
		}

		@Test
		@DisplayName("스냅숏_없는코드면_404다")
		void snapshot_unknownCode_returnsNotFound() throws Exception {
			when(meetupService.snapshot(eq("unknown"), isNull(), isNull())).thenThrow(new MeetupNotFoundException());
			expectProblem(get("/api/v1/meetups/{code}", "unknown"), 404);
		}

	}

	@Nested
	@DisplayName("프로필")
	class Profiles {

		private final MeetupProfileService.Joined joined = new MeetupProfileService.Joined(5L, "token-value",
				Duration.ofDays(3));

		private MockHttpServletRequestBuilder createProfile(String body) {
			return post("/api/v1/meetups/{code}/profiles", CODE).with(SessionTestSupport.csrf())
					.contentType(MediaType.APPLICATION_JSON).content(body);
		}

		private String meetupCookie(MockHttpServletRequestBuilder request) throws Exception {
			return mockMvc.perform(request).andReturn().getResponse().getHeaders("Set-Cookie").stream()
					.filter(cookie -> cookie.startsWith("fitdining_meetup=")).findFirst().orElse(null);
		}

		@Test
		@DisplayName("프로필만들기_로그인없이도_201과모임쿠키를받고쓰기한도를센다")
		void createProfile_anonymous_setsMeetupCookie() throws Exception {
			when(profileService.create(eq(CODE), isNull(), any())).thenReturn(joined);
			String body = "{\"name\":\"하린\",\"taste\":{\"mood\":\"QUIET\",\"likeFoods\":[\"KOREAN\"],\"noSpicy\":true}}";

			mockMvc.perform(createProfile(body))
					.andExpect(status().isCreated())
					.andExpect(header().string("Cache-Control", "no-store"))
					.andExpect(jsonPath("$.profileId").value(5));

			assertThat(meetupCookie(createProfile(body))).startsWith("fitdining_meetup=token-value")
					.contains("Path=/api/v1/meetups/" + CODE).contains("HttpOnly").contains("SameSite=Lax")
					.contains("Max-Age=259200").doesNotContain("Secure");
			verify(writeLimiter, times(2)).count(eq(CODE), anyString());
			verify(profileService, times(2)).create(CODE, null, new ProfileCreateRequest("하린",
					new Taste(Mood.QUIET, List.of(FoodType.KOREAN), null, true, null, null)));
		}

		@Test
		@DisplayName("프로필만들기_로그인했으면_쓰기한도를세지않고회원id로만든다")
		void createProfile_signedIn_skipsLimiter() throws Exception {
			when(profileService.create(eq(CODE), eq(USER_ID), any())).thenReturn(joined);
			mockMvc.perform(createProfile("{\"name\":\"민재\"}").with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isCreated());
			verify(writeLimiter, never()).count(anyString(), anyString());
		}

		@Test
		@DisplayName("프로필만들기_쓰기한도를넘으면_429다")
		void createProfile_overLimit_returnsTooManyRequests() throws Exception {
			doThrow(new TooManyMeetupWritesException()).when(writeLimiter).count(anyString(), anyString());
			expectProblem(createProfile("{\"name\":\"하린\"}"), 429);
			verify(profileService, never()).create(anyString(), any(), any());
		}

		@Test
		@DisplayName("프로필만들기_CSRF토큰이없으면_403이다")
		void createProfile_withoutCsrf_returnsForbidden() throws Exception {
			expectProblem(post("/api/v1/meetups/{code}/profiles", CODE).contentType(MediaType.APPLICATION_JSON)
					.content("{\"name\":\"하린\"}"), 403);
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"{}",
				"{\"name\":\"하린\",\"color\":1}",
				"{\"name\":\"하린\",\"taste\":{\"mood\":\"SILENT\"}}",
				"{\"name\":\"하린\",\"taste\":{\"likeFoods\":[\"KOREAN\",\"PIZZA\"]}}",
				"{\"name\":\"하린\",\"taste\":{\"priceCap\":\"만원\"}}",
				"{\"name\":\"하린\",\"taste\":{\"spicy\":true}}"
		})
		@DisplayName("프로필만들기_형식이틀리거나모르는속성이있으면_400이다")
		void createProfile_invalidShape_returnsBadRequest(String body) throws Exception {
			expectProblem(createProfile(body), 400);
			verify(profileService, never()).create(anyString(), any(), any());
		}

		@ParameterizedTest
		@EnumSource(value = Conflict.class, names = {"NAME_TAKEN", "FULL", "ALREADY_JOINED"})
		@DisplayName("프로필만들기_부딪히면_409와종류를받는다")
		void createProfile_conflict_returnsType(Conflict conflict) throws Exception {
			when(profileService.create(eq(CODE), isNull(), any())).thenThrow(new MeetupConflictException(conflict));
			mockMvc.perform(createProfile("{\"name\":\"하린\"}"))
					.andExpect(status().isConflict())
					.andExpect(jsonPath("$.type").value(conflict.type().toString()));
		}

		@Test
		@DisplayName("프로필고르기_비회원이면_204와모임쿠키를받는다")
		void selectProfile_anonymous_setsMeetupCookie() throws Exception {
			when(profileService.select(CODE, 7L, null)).thenReturn(joined);
			assertThat(meetupCookie(post("/api/v1/meetups/{code}/profiles/{id}/session", CODE, 7)
					.with(SessionTestSupport.csrf()))).startsWith("fitdining_meetup=token-value");
		}

		@Test
		@DisplayName("프로필고르기_남의회원프로필이면_403이다")
		void selectProfile_otherMember_returnsForbidden() throws Exception {
			when(profileService.select(CODE, 7L, null)).thenThrow(new MeetupForbiddenException());
			expectProblem(post("/api/v1/meetups/{code}/profiles/{id}/session", CODE, 7)
					.with(SessionTestSupport.csrf()), 403);
		}

		@Test
		@DisplayName("취향수정_모임쿠키를_서비스에넘긴다")
		void updateTaste_passesMeetupCookie() throws Exception {
			mockMvc.perform(put("/api/v1/meetups/{code}/profiles/me/taste", CODE).with(SessionTestSupport.csrf())
							.cookie(new Cookie("fitdining_meetup", "cookie-value"))
							.contentType(MediaType.APPLICATION_JSON).content("{\"mood\":\"LIVELY\"}"))
					.andExpect(status().isNoContent());
			verify(profileService).updateTaste(CODE, null, "cookie-value",
					new Taste(Mood.LIVELY, null, null, null, null, null));
		}

		@Test
		@DisplayName("스냅숏_모임쿠키를_서비스에넘긴다")
		void snapshot_passesMeetupCookie() throws Exception {
			mockMvc.perform(get("/api/v1/meetups/{code}", CODE).cookie(new Cookie("fitdining_meetup", "cookie-value")));
			verify(meetupService).snapshot(CODE, null, "cookie-value");
		}

		@Test
		@DisplayName("프로필지우기_로그인하지않으면_401이다")
		void removeProfile_anonymous_returnsUnauthorized() throws Exception {
			expectProblem(delete("/api/v1/meetups/{code}/profiles/{id}", CODE, 3).with(SessionTestSupport.csrf()), 401);
			verify(profileService, never()).remove(anyString(), anyString(), org.mockito.ArgumentMatchers.anyLong());
		}

		@Test
		@DisplayName("프로필지우기_모임장자신의프로필이면_409와종류를받는다")
		void removeProfile_hostProfile_returnsConflict() throws Exception {
			doThrow(new MeetupConflictException(Conflict.HOST_PROFILE)).when(profileService).remove(CODE, USER_ID, 3L);
			mockMvc.perform(delete("/api/v1/meetups/{code}/profiles/{id}", CODE, 3).with(SessionTestSupport.csrf())
							.with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isConflict())
					.andExpect(jsonPath("$.type").value("urn:fitdining:meetup:host-profile"));
		}

	}

	@Nested
	@DisplayName("추천받기와 결과")
	class Calculations {

		@Test
		@DisplayName("추천받기_모임장이면_202다")
		void calculate_host_returnsAccepted() throws Exception {
			mockMvc.perform(post("/api/v1/meetups/{code}/calculations", CODE).with(SessionTestSupport.csrf())
							.with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isAccepted());
			verify(calculationService).start(CODE, USER_ID);
		}

		@Test
		@DisplayName("추천받기_로그인하지않으면_401이다")
		void calculate_anonymous_returnsUnauthorized() throws Exception {
			expectProblem(post("/api/v1/meetups/{code}/calculations", CODE).with(SessionTestSupport.csrf()), 401);
			verify(calculationService, never()).start(anyString(), anyString());
		}

		@Test
		@DisplayName("추천받기_계산중이면_409와종류를받는다")
		void calculate_running_returnsCalculating() throws Exception {
			doThrow(new MeetupConflictException(Conflict.CALCULATING)).when(calculationService).start(CODE, USER_ID);
			mockMvc.perform(post("/api/v1/meetups/{code}/calculations", CODE).with(SessionTestSupport.csrf())
							.with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isConflict())
					.andExpect(jsonPath("$.type").value("urn:fitdining:meetup:calculating"))
					.andExpect(jsonPath("$.phase").doesNotExist());
		}

		@Test
		@DisplayName("추천받기_할수없는상태면_409와지금상태를받는다")
		void calculate_wrongPhase_returnsPhase() throws Exception {
			doThrow(MeetupConflictException.phase(MeetupPhase.VOTING)).when(calculationService).start(CODE, USER_ID);
			mockMvc.perform(post("/api/v1/meetups/{code}/calculations", CODE).with(SessionTestSupport.csrf())
							.with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isConflict())
					.andExpect(jsonPath("$.type").value("urn:fitdining:meetup:phase"))
					.andExpect(jsonPath("$.phase").value("VOTING"));
		}

		@Test
		@DisplayName("결과_로그인없이도_200이고값없는속성은빠진다")
		void result_anonymous_returnsWithoutNullFields() throws Exception {
			MeetupRanking.Fit fit = new MeetupRanking.Fit(FitKind.ALL, List.of(1L, 2L), null, null);
			when(resultService.result(CODE)).thenReturn(new MeetupResult(5L, Instant.parse("2026-11-11T03:00:00Z"), 2,
					MeetupRecommendation.Applied.NONE,
					List.of(new MeetupResult.Item(1, new PlaceSummary(10L, "온담", PlaceSummary.CategoryGroup.RESTAURANT,
							null, 37.5, 127.0, null), null, null, ResultGroup.ALL_FIT, fit, List.of(), null, null, null,
							null)),
					null));

			mockMvc.perform(get("/api/v1/meetups/{code}/result", CODE))
					.andExpect(status().isOk())
					.andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
					.andExpect(jsonPath("$.calculationId").value(5))
					.andExpect(jsonPath("$.applied").isMap())
					.andExpect(jsonPath("$.applied.mood").doesNotExist())
					.andExpect(jsonPath("$.applied.blank").doesNotExist())
					.andExpect(jsonPath("$.items[0].fit.kind").value("ALL"))
					.andExpect(jsonPath("$.items[0].fit.misfitProfileIds").doesNotExist())
					.andExpect(jsonPath("$.items[0].score").doesNotExist())
					.andExpect(jsonPath("$.emptyReason").doesNotExist());
		}

		@Test
		@DisplayName("결과_아직없으면_404다")
		void result_none_returnsNotFound() throws Exception {
			when(resultService.result(CODE)).thenThrow(new MeetupResultNotFoundException());
			expectProblem(get("/api/v1/meetups/{code}/result", CODE), 404);
		}

	}

	@Nested
	@DisplayName("로그")
	@ExtendWith(OutputCaptureExtension.class)
	class Logging {

		@Test
		@DisplayName("만들기_정상요청후_로그에모임설명이없다")
		void create_success_doesNotLogDescription(CapturedOutput output) throws Exception {
			mockMvc.perform(create(valid(",\"description\":\"" + LOG_SECRET + "\""))).andExpect(status().isCreated());
			assertThat(output.getAll()).doesNotContain(LOG_SECRET);
		}

		@Test
		@DisplayName("프로필만들기_정상요청과409뒤에도_로그에이름과메뉴가없다")
		void createProfile_doesNotLogNameOrTaste(CapturedOutput output) throws Exception {
			when(profileService.create(eq(CODE), isNull(), any()))
					.thenReturn(new MeetupProfileService.Joined(1L, "t", Duration.ofDays(1)))
					.thenThrow(new MeetupConflictException(Conflict.NAME_TAKEN));
			String body = "{\"name\":\"비밀이름임\",\"taste\":{\"wantMenu\":\"비밀메뉴곱창\"}}";
			mockMvc.perform(post("/api/v1/meetups/{code}/profiles", CODE).with(SessionTestSupport.csrf())
					.contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isCreated());
			mockMvc.perform(post("/api/v1/meetups/{code}/profiles", CODE).with(SessionTestSupport.csrf())
					.contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isConflict());
			assertThat(output.getAll()).doesNotContain("비밀이름임").doesNotContain("비밀메뉴곱창");
		}

		@Test
		@DisplayName("만들기_400이나도_로그에모임설명이없다")
		void create_rejected_doesNotLogDescription(CapturedOutput output) throws Exception {
			mockMvc.perform(create(valid(",\"description\":\"" + LOG_SECRET + "\",\"headcount\":\"넷\"")))
					.andExpect(status().isBadRequest());
			when(meetupService.create(anyString(), any())).thenThrow(new InvalidMeetupException());
			mockMvc.perform(create(valid(",\"description\":\"" + LOG_SECRET + "\""))).andExpect(status().isBadRequest());
			assertThat(output.getAll()).doesNotContain(LOG_SECRET);
		}

	}

}
