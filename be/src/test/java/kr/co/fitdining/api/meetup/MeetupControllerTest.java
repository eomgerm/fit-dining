package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.support.SessionTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
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
				new MeetupQuestions(true, true, true, false), new MeetupSnapshot.Me(MeetupRole.VIEWER, null, false),
				List.of(MeetupAction.JOIN), List.of());

		@Test
		@DisplayName("스냅숏_로그인없이도_200이고값없는속성은빠진다")
		void snapshot_anonymous_returnsWithoutNullFields() throws Exception {
			when(meetupService.snapshot(eq(CODE), isNull())).thenReturn(waiting);

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
			when(meetupService.snapshot(eq(CODE), isNull())).thenReturn(waiting);

			var result = mockMvc.perform(get("/api/v1/meetups/{code}", CODE)).andExpect(status().isOk()).andReturn();

			assertThat(result.getRequest().getSession(false)).isNull();
			assertThat(result.getResponse().getHeaders("Set-Cookie"))
					.noneMatch(cookie -> cookie.startsWith("fitdining_session="));
		}

		@Test
		@DisplayName("스냅숏_로그인했으면_회원id로묻는다")
		void snapshot_signedIn_passesUserId() throws Exception {
			when(meetupService.snapshot(CODE, USER_ID)).thenReturn(waiting);

			mockMvc.perform(get("/api/v1/meetups/{code}", CODE).with(SessionTestSupport.session(USER_ID)))
					.andExpect(status().isOk());
			verify(meetupService).snapshot(CODE, USER_ID);
		}

		@Test
		@DisplayName("스냅숏_없는코드면_404다")
		void snapshot_unknownCode_returnsNotFound() throws Exception {
			when(meetupService.snapshot(eq("unknown"), isNull())).thenThrow(new MeetupNotFoundException());
			expectProblem(get("/api/v1/meetups/{code}", "unknown"), 404);
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
