package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.Optional;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceCard.ScoreItem;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.user.Preferences;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.mock.http.client.MockClientHttpResponse;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

@ExtendWith(OutputCaptureExtension.class)
/** AI 검색 클라이언트. 가짜 AI 서버({@link MockRestServiceServer})로 요청 본문, 응답 변환, 실패 분류, 차단기를 본다. */
class AiSearchClientTest {

	static final String URL = "http://ai.test/v1/search";
	static final String OK = """
			{"conditions":{"text":"t"},"nearby":false,"items":[{"placeId":1,"score":80}],
			 "interpretedBy":"LLM","rankedBy":"LLM","fallbacks":[],"models":{"llm":"m"}}""";

	/** time-out 8초에 운영과 같은 재요청·permit 대기 값. MockRestServiceServer는 시간이 흐르지 않아 남은 시간이 줄지 않는다. */
	static final AiSearchClient.Timing TIMING = new AiSearchClient.Timing(Duration.ofSeconds(8),
			AiSearchClient.MIN_RETRY_TIME, AiSearchClient.MAX_RETRY_AFTER, AiSearchClient.PERMIT_WAIT);

	final MutableClock clock = new MutableClock(Instant.parse("2026-10-31T03:00:00Z"));
	/** 실제로 thread를 멈추지 않고 요청받은 대기 시간만 남긴다 */
	final List<Duration> slept = new ArrayList<>();
	MockRestServiceServer server;
	RestClient rest;

	@BeforeEach
	void setUp() {
		RestClient.Builder builder = RestClient.builder();
		server = MockRestServiceServer.bindTo(builder).build();
		rest = builder.build();
	}

	@AfterEach
	void verify() {
		server.verify();
	}

	AiSearchClient client(String baseUrl, String key, String secret) {
		return new AiSearchClient(baseUrl, key, secret, TIMING, clock, timeout -> rest, slept::add);
	}

	AiSearchClient client() {
		return client("http://ai.test", "", "");
	}

	static final String SECRET = "비밀표식9c41";
	static final String BUSY = "{\"status\":503,\"code\":\"BUSY\"}";

	static PlaceSearchRequest request(String query) {
		return new PlaceSearchRequest(query, null, null, null, null);
	}

	/** 다른 주소의 응답을 읽는 타입 */
	record Echo(String value) {
	}

	@Nested
	@DisplayName("다른 주소")
	class OtherPath {

		static final String MEETUP = "http://ai.test/v1/meetup/search";

		@Test
		@DisplayName("다른주소_본문을그경로로보내고_응답을그타입으로읽는다")
		void post_sendsBodyToPath_readsType() {
			server.expect(requestTo(MEETUP)).andExpect(method(HttpMethod.POST))
					.andExpect(content().json("{\"members\":[{\"key\":\"1\"}]}", JsonCompareMode.STRICT))
					.andRespond(withSuccess("{\"value\":\"ok\",\"extra\":1}", MediaType.APPLICATION_JSON));

			AiSearchClient.Reply<Echo> reply = client().post("meetup search", "/v1/meetup/search",
					Map.of("members", java.util.List.of(Map.of("key", "1"))), Echo.class, echo -> echo.value() != null);

			assertThat(reply.ok()).isTrue();
			assertThat(reply.value()).isEqualTo(new Echo("ok"));
			assertThat(reply.status()).isEqualTo(200);
		}

		@Test
		@DisplayName("다른주소_AI가400과code로답하면_상태와code를돌려주고이름으로로그를남긴다")
		void post_badRequest_returnsStatusAndCode(CapturedOutput output) {
			server.expect(requestTo(MEETUP)).andRespond(withStatus(HttpStatus.BAD_REQUEST)
					.contentType(MediaType.APPLICATION_JSON).body("{\"status\":400,\"code\":\"CONDITIONS_INVALID\"}"));

			AiSearchClient.Reply<Echo> reply = client().post("meetup search", "/v1/meetup/search", Map.of(),
					Echo.class, echo -> true);

			assertThat(reply.ok()).isFalse();
			assertThat(reply.status()).isEqualTo(400);
			assertThat(reply.code()).isEqualTo("CONDITIONS_INVALID");
			assertThat(output.getAll()).contains("AI meetup search failed: kind=STATUS, reason=400:CONDITIONS_INVALID");
		}

		@Test
		@DisplayName("다른주소_실패해도_본문의값은로그에남지않는다")
		void post_failure_bodyNotLogged(CapturedOutput output) {
			server.expect(requestTo(MEETUP)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR).body(SECRET));

			client().post("meetup search", "/v1/meetup/search",
					Map.of("members", java.util.List.of(Map.of("key", "1", "wantMenu", SECRET))), Echo.class,
					echo -> true);

			assertThat(output.getAll()).contains("AI meetup search failed: kind=SERVER_ERROR")
					.doesNotContain(SECRET);
		}

		@Test
		@DisplayName("다른주소_쓸수없는응답이면_실패하고상태가없다")
		void post_unreadable_fails(CapturedOutput output) {
			server.expect(requestTo(MEETUP)).andRespond(withSuccess("{\"value\":null}", MediaType.APPLICATION_JSON));

			AiSearchClient.Reply<Echo> reply = client().post("meetup search", "/v1/meetup/search", Map.of(),
					Echo.class, echo -> echo.value() != null);

			assertThat(reply.ok()).isFalse();
			assertThat(reply.status()).isZero();
			assertThat(reply.code()).isNull();
			assertThat(output.getAll()).contains("kind=INVALID");
		}
	}

	@Nested
	@DisplayName("AI 요청")
	class Request {

		@Test
		@DisplayName("AI요청_질의만있으면_query만보낸다")
		void request_queryOnly_sendsQueryOnly() {
			server.expect(requestTo(URL)).andExpect(method(HttpMethod.POST))
					.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
					.andExpect(content().json("{\"query\":\"근처 맛집\"}", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("근처 맛집"), null)).isPresent();
		}

		@Test
		@DisplayName("AI요청_모든값이있으면_표의속성만그대로보내고안쪽null을지킨다")
		void request_allValues_sendsTableFieldsKeepingInnerNull() {
			Map<String, Object> previous = new LinkedHashMap<>();
			previous.put("text", "이전");
			previous.put("station", null);
			previous.put("nested", new HashMap<>(Map.of("codes", java.util.List.of("QUIET"))));
			PlaceSearchRequest request = new PlaceSearchRequest("  역삼 카페 ", new Preferences(Preferences.Mood.QUIET,
					null, null, null), previous, new MapBounds(37.49, null, 37.51, 127.05), null);
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"  역삼 카페 ","previousConditions":{"text":"이전","station":null,
							 "nested":{"codes":["QUIET"]}},"mapBounds":{"swLat":37.49,"neLat":37.51,"neLng":127.05},
							 "userId":"user-1"}""", JsonCompareMode.STRICT))
					.andExpect(content().string(org.hamcrest.Matchers.containsString("\"station\":null")))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.SEARCH, request, "user-1");
		}

		@Test
		@DisplayName("AI요청_비회원답변이있으면_tasteProfile로그대로보낸다")
		void request_guestPreferences_sentAsTasteProfile() {
			Preferences preferences = new Preferences(Preferences.Mood.QUIET, List.of(Preferences.Priority.SPACIOUS),
					List.of(Preferences.Purpose.DATE), List.of(
							new Preferences.TasteChip(Preferences.Polarity.LIKE, "조용한 곳", "QUIET"),
							new Preferences.TasteChip(Preferences.Polarity.DISLIKE, "매운 음식")));
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"카페","tasteProfile":{"mood":"QUIET","priorities":["SPACIOUS"],"purposes":["DATE"],
							 "tastes":[{"polarity":"LIKE","label":"조용한 곳","code":"QUIET"},
							           {"polarity":"DISLIKE","label":"매운 음식"}]}}""", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.SEARCH, new PlaceSearchRequest("카페", preferences, null, null, null), null);
		}

		@Test
		@DisplayName("AI요청_비회원답변의빈값은_null은빼고빈목록은그대로보낸다")
		void request_guestPreferencesEmptyValues_dropsNullsKeepsEmptyLists() {
			server.expect(requestTo(URL))
					.andExpect(content().string("""
							{"query":"카페","tasteProfile":{"priorities":[],"purposes":[],\
							"tastes":[{"polarity":"LIKE","label":"창가 자리"}]}}"""))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.SEARCH, new PlaceSearchRequest("카페", new Preferences(null, null, null,
					List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "창가 자리"))), null, null, null), null);
		}

		@Test
		@DisplayName("AI요청_빈이전조건과빈지도영역은_빼고null로도넣지않는다")
		void request_emptyPreviousAndBounds_omitted() {
			server.expect(requestTo(URL))
					.andExpect(content().string("{\"query\":\"카페\"}"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.SEARCH, new PlaceSearchRequest("카페", null, Map.of(), new MapBounds(null, null, null, null), null),
					null);
		}

		@Test
		@DisplayName("AI요청_Modal키와비밀이있으면_헤더로싣는다")
		void request_modalCredentials_sentAsHeaders() {
			server.expect(requestTo(URL)).andExpect(header("Modal-Key", "key")).andExpect(header("Modal-Secret", "secret"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client("http://ai.test", "key", "secret").search(SearchPurpose.SEARCH, request("카페"), null);
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "   "})
		@DisplayName("AI요청_Modal키와비밀이비었거나공백뿐이면_헤더가없다")
		void request_blankModalCredentials_noHeaders(String blank) {
			server.expect(requestTo(URL)).andExpect(headerDoesNotExist("Modal-Key"))
					.andExpect(headerDoesNotExist("Modal-Secret"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client("http://ai.test", blank, blank).search(SearchPurpose.SEARCH, request("카페"), null);
		}
	}

	@Nested
	@DisplayName("목적별 AI 요청 (place-ai-search D-18)")
	class PurposeRequest {

		static final MapBounds AREA = new MapBounds(37.49, 127.02, 37.51, 127.05);

		@Test
		@DisplayName("AI요청_NEARBY는_상수문장과네값영역과rulesOnly를보낸다")
		void request_nearby_sendsConstantQueryAreaAndRulesOnly() {
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"근처 맛집","mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":37.51,"neLng":127.05},
							 "rulesOnly":true}""", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.NEARBY, new PlaceSearchRequest("아무 문장", null, null, AREA, null), null);
		}

		@Test
		@DisplayName("AI요청_NEARBY는_요청에조건이있어도previousConditions를보내지않는다")
		void request_nearbyWithConditions_omitsPrevious() {
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"근처 맛집","mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":37.51,"neLng":127.05},
							 "rulesOnly":true}""", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.NEARBY, new PlaceSearchRequest("카페", null, Map.of("text", "이전"), AREA,
					null), null);
		}

		@Test
		@DisplayName("AI요청_REGION은_조건을previousConditions로영역과mapFirst와함께보낸다")
		void request_region_sendsConditionsAsPreviousWithMapFirst() {
			Map<String, Object> conditions = new LinkedHashMap<>();
			conditions.put("text", "강남역 파스타");
			conditions.put("station", null);
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"강남역 파스타","previousConditions":{"text":"강남역 파스타","station":null},
							 "mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":37.51,"neLng":127.05},
							 "mapFirst":true}""", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.REGION, new PlaceSearchRequest("강남역 파스타", null, conditions, AREA, null),
					null);
		}

		@Test
		@DisplayName("AI요청_REGION의조건이비었으면_previousConditions없이mapFirst를보낸다")
		void request_regionEmptyConditions_omitsPrevious() {
			server.expect(requestTo(URL))
					.andExpect(content().json("""
							{"query":"파스타","mapBounds":{"swLat":37.49,"swLng":127.02,"neLat":37.51,"neLng":127.05},
							 "mapFirst":true}""", JsonCompareMode.STRICT))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.REGION, new PlaceSearchRequest("파스타", null, Map.of(), AREA, null), null);
		}

		@Test
		@DisplayName("AI요청_SEARCH는_rulesOnly와mapFirst를false로도넣지않는다")
		void request_search_noPurposeFlags() {
			server.expect(requestTo(URL))
					.andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("rulesOnly"))))
					.andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("mapFirst"))))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(SearchPurpose.SEARCH, new PlaceSearchRequest("근처 맛집", null, Map.of("text", "t"), AREA, null),
					null);
		}

		@ParameterizedTest
		@EnumSource(SearchPurpose.class)
		@DisplayName("AI요청_목적과상관없이_회원은userId만비회원은tasteProfile을보낸다")
		void request_anyPurpose_userIdOrTasteProfile(SearchPurpose purpose) {
			Preferences preferences = new Preferences(Preferences.Mood.QUIET, null, null, null);
			server.expect(requestTo(URL))
					.andExpect(jsonPath("$.userId").value("user-1"))
					.andExpect(jsonPath("$.tasteProfile").doesNotExist())
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));
			server.expect(requestTo(URL))
					.andExpect(jsonPath("$.userId").doesNotExist())
					.andExpect(jsonPath("$.tasteProfile.mood").value("QUIET"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));
			PlaceSearchRequest request = new PlaceSearchRequest("카페", preferences, null, AREA, null);

			client().search(purpose, request, "user-1");
			client().search(purpose, request, null);
		}
	}

	@Nested
	@DisplayName("AI 응답")
	class ResponseConversion {

		@Test
		@DisplayName("AI응답_모든필드를_그대로읽는다")
		void response_allFields_readAsIs() {
			server.expect(requestTo(URL)).andRespond(withSuccess("""
					{"conditions":{"text":"t","station":null},"nearby":true,"changeSummary":"넓은 곳",
					 "emptyReason":{"cause":"c","suggestion":"s"},
					 "items":[{"placeId":7,"score":91,"labels":["조용해요"],
					   "reasons":[{"source":"REQUEST","code":"QUIET","label":"조용해요","value":0.95,"fromReviews":true,"fallbackTitle":"카페 중 손꼽히게 조용해요"}],
					   "scoreItems":[{"source":"PREFERENCE","label":"넓어요","matched":false,"evidenceCount":0}]}],
					 "fallbacks":["PREVIOUS_INVALID","TASTE_INVALID"],"interpretedBy":"RULE","rankedBy":"SIMILARITY",
					 "models":{"embedding":"e"}}""", MediaType.APPLICATION_JSON));

			AiSearchClient.Response response = client().search(SearchPurpose.SEARCH, request("카페"), null).orElseThrow();

			assertThat(response.conditions()).containsEntry("text", "t").containsEntry("station", null);
			assertThat(response.nearby()).isTrue();
			assertThat(response.changeSummary()).isEqualTo("넓은 곳");
			assertThat(response.emptyReason().cause()).isEqualTo("c");
			assertThat(response.fallbacks()).containsExactly("PREVIOUS_INVALID", "TASTE_INVALID");
			AiSearchClient.Item item = response.items().getFirst();
			assertThat(item.placeId()).isEqualTo(7L);
			assertThat(item.score()).isEqualTo(91);
			assertThat(item.labels()).containsExactly("조용해요");
			assertThat(item.reasons()).containsExactly(new Reason(EvidenceSource.REQUEST, "QUIET", "조용해요", 0.95, true,
					"카페 중 손꼽히게 조용해요"));
			assertThat(item.scoreItems()).containsExactly(new ScoreItem(EvidenceSource.PREFERENCE, "넓어요", false, 0));
		}

		@Test
		@DisplayName("AI응답_어느깊이든모르는속성과빠진값은_무시하고읽는다")
		void response_unknownPropertiesAnywhere_ignored() {
			server.expect(requestTo(URL)).andRespond(withSuccess("""
					{"items":[{"placeId":1,"extra":1,"reasons":[{"source":"REQUEST","code":"QUIET","label":"l","x":2,"y":3}],
					  "scoreItems":[{"source":"REQUEST","label":"l","z":[1]}]}],"newTop":{"a":1},
					 "interpretedBy":{"any":[1]},"rankedBy":3,"models":"text"}""", MediaType.APPLICATION_JSON));

			AiSearchClient.Response response = client().search(SearchPurpose.SEARCH, request("카페"), null).orElseThrow();

			assertThat(response.items()).singleElement().satisfies(item -> {
				assertThat(item.score()).isNull();
				assertThat(item.labels()).isNull();
			});
			assertThat(response.conditions()).isNull();
			assertThat(response.fallbacks()).isNull();
		}
	}

	@Nested
	@DisplayName("AI 실패")
	class Failures {

		@ParameterizedTest
		@ValueSource(strings = {"", "   "})
		@DisplayName("AI실패_주소가비었거나공백뿐이면_부르지않고ERROR다")
		void failure_blankBaseUrl_skipsCallAndLogsError(String blank, CapturedOutput output) {
			assertThat(client(blank, "", "").search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("base-url is blank");
		}

		@Test
		@DisplayName("AI실패_형식이잘못된주소는_ERROR로대체한다")
		void failure_malformedBaseUrl_logsError(CapturedOutput output) {
			assertThat(client("http://ai test", "", "").search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID");
		}

		@Test
		@DisplayName("AI실패_형식이잘못된주소로빈을만들어도_생성은실패하지않고검색은대체한다")
		void failure_malformedBaseUrlInBeanConstructor_constructsAndFallsBack(CapturedOutput output) {
			// 스프링이 쓰는 생성자다. 여기서 주소를 해석하면 기동이 실패한다(AC-7 ⑦).
			AiSearchClient bean = new AiSearchClient("http://ai test", "", "", Optional.empty());

			assertThat(bean.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID");
		}

		@ParameterizedTest
		@ValueSource(classes = {UnknownHostException.class, ConnectException.class, IOException.class})
		@DisplayName("AI실패_연결실패는_WARN이다")
		void failure_connection_logsWarn(Class<? extends IOException> type, CapturedOutput output) throws Exception {
			server.expect(requestTo(URL)).andRespond(withException(type.getConstructor(String.class).newInstance(SECRET)));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=CONNECTION").contains(type.getSimpleName())
					.doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_시간초과는_WARN이다")
		void failure_timeout_logsWarn(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withException(new SocketTimeoutException(SECRET)));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=TIMEOUT").doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(strings = {"EMBEDDING_UNAVAILABLE", "PLACES_UNAVAILABLE", "INTERNAL_ERROR"})
		@DisplayName("AI실패_5xx본문에code가있으면_상태코드와code를로그에남긴다")
		void failure_serverErrorCode_loggedWithStatus(String code, CapturedOutput output) {
			int status = code.equals("INTERNAL_ERROR") ? 500 : 503;
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatusCode.valueOf(status))
					.body("{\"code\":\"" + code + "\",\"detail\":\"" + SECRET + "\"}")
					.contentType(MediaType.APPLICATION_PROBLEM_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=SERVER_ERROR")
					.contains("reason=" + status + ":" + code + ",").contains("elapsedMs=").doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(strings = {"\"lower_case\"", "\"" + SECRET + "\"", "\"A B\"", "1", "null"})
		@DisplayName("AI실패_code가대문자상수가아니면_상태코드만남긴다")
		void failure_unexpectedCode_logsStatusOnly(String code, CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE)
					.body("{\"code\":" + code + "}").contentType(MediaType.APPLICATION_PROBLEM_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("reason=503,").doesNotContain(SECRET).doesNotContain("lower_case");
		}

		@ParameterizedTest
		@ValueSource(ints = {500, 502, 503, 504})
		@DisplayName("AI실패_BUSY가아닌5xx는_다시부르지않고WARN이다")
		void failure_serverError_noRetryAndWarn(int status, CapturedOutput output) {
			server.expect(ExpectedCount.once(), requestTo(URL))
					.andRespond(withStatus(HttpStatusCode.valueOf(status)).body("{\"code\":\"OTHER\",\"detail\":\"" + SECRET + "\"}")
							.contentType(MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=SERVER_ERROR").contains("reason=" + status)
					.doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(ints = {400, 401, 404, 422, 302, 201, 204})
		@DisplayName("AI실패_200이아닌그밖의상태는_ERROR다")
		void failure_otherStatus_logsError(int status, CapturedOutput output) {
			server.expect(ExpectedCount.once(), requestTo(URL))
					.andRespond(withStatus(HttpStatusCode.valueOf(status)).body(SECRET));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=STATUS").contains("reason=" + status)
					.doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(strings = {
				"비밀표식9c41",
				"",
				"null",
				"[]",
				"{\"conditions\":{\"text\":\"비밀표식9c41\"}}",
				"{\"items\":null}",
				"{\"items\":[null]}",
				"{\"items\":[{\"score\":1}]}",
				"{\"items\":[{\"placeId\":null}]}",
				"{\"items\":[{\"placeId\":\"비밀표식9c41\"}]}",
				"{\"items\":[{\"placeId\":1,\"labels\":[null]}]}",
				"{\"items\":[{\"placeId\":1,\"reasons\":[null]}]}",
				"{\"items\":[{\"placeId\":1,\"scoreItems\":[null]}]}",
				"{\"items\":[{\"placeId\":1,\"scoreItems\":[{\"source\":\"UNKNOWN\",\"label\":\"비밀표식9c41\"}]}]}",
				"{\"items\":[],\"fallbacks\":[null]}",
				"{\"items\":[],\"fallbacks\":\"x\"}",
				"{\"items\":[],\"conditions\":[\"비밀표식9c41\"]}",
				"{\"items\":[],\"nearby\":{\"a\":1}}",
				"{\"items\":[],\"emptyReason\":\"비밀표식9c41\"}",
				"{\"items\":[]} 비밀표식9c41"
		})
		@DisplayName("AI실패_읽을수없는200응답은_ERROR이고본문을남기지않는다")
		void failure_unreadableBody_logsErrorWithoutBody(String body, CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withSuccess(body, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID").doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_그밖의예외는_ERROR로대체한다")
		void failure_unexpectedException_logsError(CapturedOutput output) {
			AiSearchClient failing = new AiSearchClient("http://ai.test", "", "", TIMING, clock,
					timeout -> {
						throw new IllegalStateException(SECRET);
					}, slept::add);

			assertThat(failing.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("IllegalStateException").doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_요청본문과질의는_로그에없다")
		void failure_requestValues_notLogged(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));

			client().search(SearchPurpose.SEARCH, new PlaceSearchRequest(SECRET, null, Map.of("text", SECRET), null, null), "user-1");

			assertThat(output.getAll()).doesNotContain(SECRET);
		}

		@ParameterizedTest
		@EnumSource(value = SearchPurpose.class, names = {"NEARBY", "REGION"})
		@DisplayName("AI실패_영역요청의좌표와조건은_로그에없다")
		void failure_areaValues_notLogged(SearchPurpose purpose, CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));

			client().search(purpose, new PlaceSearchRequest(SECRET, null, Map.of("text", SECRET),
					new MapBounds(37.4987654321, 127.0123456789, 37.5123456789, 127.0587654321), null), null);

			assertThat(output.getAll()).doesNotContain(SECRET).doesNotContain("37.4987654321")
					.doesNotContain("127.0123456789").doesNotContain("37.5123456789").doesNotContain("127.0587654321");
		}
	}

	@Nested
	@DisplayName("BUSY 재시도")
	class BusyRetry {

		void expectBusy(String retryAfter) {
			var response = withStatus(HttpStatus.SERVICE_UNAVAILABLE).body(BUSY)
					.contentType(MediaType.APPLICATION_PROBLEM_JSON);
			server.expect(requestTo(URL)).andRespond(retryAfter == null ? response : response.header("Retry-After",
					retryAfter));
		}

		@Test
		@DisplayName("BUSY_한번오면_RetryAfter만큼기다린뒤재요청해성공한다")
		void busy_once_waitsRetryAfterAndSucceeds() {
			expectBusy("1");
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isPresent();
			assertThat(slept).containsExactly(Duration.ofSeconds(1));
		}

		@Test
		@DisplayName("BUSY_RetryAfter가상한보다크면_상한만큼만기다린다")
		void busy_longRetryAfter_waitsAtMostTheCap() {
			expectBusy("30");
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isPresent();
			assertThat(slept).containsExactly(AiSearchClient.MAX_RETRY_AFTER);
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "0", "-1", "1.5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT"})
		@DisplayName("BUSY_RetryAfter가정수초가아니면_기다리지않고재요청한다")
		void busy_unreadableRetryAfter_retriesWithoutWaiting(String retryAfter) {
			expectBusy(retryAfter);
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isPresent();
			assertThat(slept).isEmpty();
		}

		@Test
		@DisplayName("BUSY_RetryAfter가없으면_기다리지않고재요청한다")
		void busy_noRetryAfter_retriesWithoutWaiting() {
			expectBusy(null);
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isPresent();
			assertThat(slept).isEmpty();
		}

		@Test
		@DisplayName("BUSY_대기뒤남을시간이최소처리시간보다적으면_기다리지않고BUSY실패다")
		void busy_notEnoughBudgetAfterWait_failsWithoutWaiting(CapturedOutput output) {
			// time-out 8초에서 1초를 기다리면 7초가 남아 최소 처리 시간 7.5초보다 적다
			AiSearchClient client = new AiSearchClient("http://ai.test", "", "", new AiSearchClient.Timing(
					Duration.ofSeconds(8), Duration.ofMillis(7500), AiSearchClient.MAX_RETRY_AFTER,
					AiSearchClient.PERMIT_WAIT), clock, timeout -> rest, slept::add);
			expectBusy("1");

			assertThat(client.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(slept).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=BUSY")
					.contains("reason=503:BUSY, retry skipped: leftMs=").contains("retryAfterMs=1000");
		}

		@Test
		@DisplayName("BUSY_대기중interrupt되면_재요청하지않고차단기에세지않는다")
		void busy_interruptedWhileWaiting_failsWithoutCounting(CapturedOutput output) {
			AiSearchClient client = new AiSearchClient("http://ai.test", "", "", TIMING, clock, timeout -> rest,
					duration -> {
						throw new InterruptedException();
					});
			for (int i = 0; i < AiSearchClient.FAILURE_THRESHOLD; i++) {
				expectBusy("1");
			}
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			try {
				for (int i = 0; i < AiSearchClient.FAILURE_THRESHOLD; i++) {
					assertThat(client.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
					assertThat(Thread.interrupted()).isTrue();
				}
				assertThat(client.search(SearchPurpose.SEARCH, request("카페"), null)).isPresent();
			} finally {
				Thread.interrupted();
			}
			assertThat(output.getAll()).contains("ERROR").contains("kind=INTERRUPTED").doesNotContain("circuit opened");
		}

		@Test
		@DisplayName("BUSY_재시도뒤에도오면_한번만다시부르고WARN이다")
		void busy_twice_failsAfterOneRetry(CapturedOutput output) {
			server.expect(ExpectedCount.times(2), requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE)
					.body(BUSY).contentType(MediaType.APPLICATION_PROBLEM_JSON));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=BUSY").contains("reason=503:BUSY after retry")
					.contains("elapsedMs=");
		}

		@Test
		@DisplayName("BUSY_재시도가다른실패면_그실패다")
		void busy_thenServerError_isServerError(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).body(BUSY)
					.contentType(MediaType.APPLICATION_PROBLEM_JSON));
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

			assertThat(client().search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("kind=SERVER_ERROR");
		}
	}

	@Nested
	@DisplayName("차단기")
	class CircuitBreaker {

		/** 요청마다 차례로 꺼내 쓰는 응답. MockRestServiceServer는 요청 뒤에 기대를 더할 수 없어 따로 둔다. */
		interface Reply {
			ClientHttpResponse get() throws IOException;
		}

		final Deque<Reply> replies = new ArrayDeque<>();
		int calls;
		final AiSearchClient client = new AiSearchClient("http://ai.test", "", "", TIMING, clock,
				timeout -> RestClient.builder().requestFactory((uri, method) -> new MockClientHttpRequest(method, uri) {
					@Override
					protected ClientHttpResponse executeInternal() throws IOException {
						calls++;
						return replies.removeFirst().get();
					}
				}).build(), slept::add);

		@AfterEach
		void allRepliesUsed() {
			assertThat(replies).isEmpty();
		}

		static Reply status(HttpStatus status) {
			return () -> new MockClientHttpResponse(new byte[0], status);
		}

		static Reply ok() {
			return () -> {
				MockClientHttpResponse response = new MockClientHttpResponse(OK.getBytes(StandardCharsets.UTF_8), HttpStatus.OK);
				response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
				return response;
			};
		}

		Optional<AiSearchClient.Response> call(Reply reply) {
			replies.add(reply);
			return client.search(SearchPurpose.SEARCH, request("카페"), null);
		}

		void fail(int times) {
			for (int i = 0; i < times; i++) {
				assertThat(call(status(HttpStatus.INTERNAL_SERVER_ERROR))).isEmpty();
			}
		}

		void succeed() {
			assertThat(call(ok())).isPresent();
		}

		/** AI를 부르지 않고 바로 빈 값이다 */
		void skipped() {
			int before = calls;
			assertThat(client.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			assertThat(calls).isEqualTo(before);
		}

		@Test
		@DisplayName("차단기_다른주소의실패로열린차단은_검색도막는다")
		void breaker_openedByOtherPath_skipsSearch() {
			for (int i = 0; i < 3; i++) {
				replies.add(status(HttpStatus.INTERNAL_SERVER_ERROR));
				assertThat(client.post("meetup search", "/v1/meetup/search", Map.of(), Echo.class, echo -> true).ok())
						.isFalse();
			}

			skipped();
			assertThat(calls).isEqualTo(3);
		}

		@Test
		@DisplayName("차단기_NEARBY실패로열린차단은_SEARCH와REGION도막는다")
		void breaker_openedByNearby_skipsOtherPurposes() {
			PlaceSearchRequest area = new PlaceSearchRequest("카페", null, null,
					new MapBounds(37.49, 127.02, 37.51, 127.05), null);
			for (int i = 0; i < 3; i++) {
				replies.add(status(HttpStatus.INTERNAL_SERVER_ERROR));
				assertThat(client.search(SearchPurpose.NEARBY, area, null)).isEmpty();
			}

			skipped();
			assertThat(client.search(SearchPurpose.REGION, area, null)).isEmpty();
			assertThat(calls).isEqualTo(3);
		}

		@Test
		@DisplayName("차단기_세번연속실패하면_30초동안부르지않고WARN을남긴다")
		void breaker_threeFailures_opensForThirtySeconds(CapturedOutput output) {
			fail(2);
			assertThat(output.getAll()).doesNotContain("circuit opened");
			fail(1);
			assertThat(output.getAll()).contains("WARN").contains("AI search circuit opened");

			clock.advance(Duration.ofSeconds(29));
			skipped();
			assertThat(output.getAll().split("kind=SERVER_ERROR", -1)).hasSize(4);

			clock.advance(Duration.ofSeconds(1));
			succeed();
			assertThat(output.getAll()).contains("AI search circuit closed: skippedWhileOpen=1");
		}

		@Test
		@DisplayName("차단기_두번실패뒤성공하면_수가0이되어다시세번이필요하다")
		void breaker_successAfterTwoFailures_resetsCount(CapturedOutput output) {
			fail(2);
			succeed();
			fail(2);
			succeed();
			assertThat(output.getAll()).doesNotContain("circuit opened").doesNotContain("circuit closed");
		}

		@ParameterizedTest
		@ValueSource(classes = {ConnectException.class, SocketTimeoutException.class})
		@DisplayName("차단기_연결실패와시간초과도_센다")
		void breaker_connectionAndTimeout_counted(Class<? extends IOException> type) {
			for (int i = 0; i < 3; i++) {
				assertThat(call(() -> {
					throw newInstance(type);
				})).isEmpty();
			}
			skipped();
		}

		@Test
		@DisplayName("차단기_재시도뒤BUSY도_센다")
		void breaker_busyAfterRetry_counted() {
			for (int i = 0; i < 6; i++) {
				replies.add(busy());
			}
			for (int i = 0; i < 3; i++) {
				assertThat(client.search(SearchPurpose.SEARCH, request("카페"), null)).isEmpty();
			}
			skipped();
		}

		@Test
		@DisplayName("차단기_30초뒤시험호출이실패하면_다시30초차단한다")
		void breaker_failedTrialCall_reopens(CapturedOutput output) {
			fail(3);
			clock.advance(Duration.ofSeconds(30));
			fail(1);
			assertThat(output.getAll().split("circuit opened", -1)).hasSize(3);

			clock.advance(Duration.ofSeconds(29));
			skipped();
			clock.advance(Duration.ofSeconds(1));
			succeed();
		}

		@Test
		@DisplayName("차단기_200외상태와읽을수없는응답은_세지않는다")
		void breaker_statusAndInvalid_notCounted() {
			for (int i = 0; i < 3; i++) {
				assertThat(call(status(HttpStatus.BAD_REQUEST))).isEmpty();
				assertThat(call(() -> new MockClientHttpResponse("x".getBytes(StandardCharsets.UTF_8), HttpStatus.OK)))
						.isEmpty();
			}
			fail(2);
			succeed();
		}

		@Test
		@DisplayName("차단기_차단중에끝난실패는_끝시각을그때부터30초로다시잡는다")
		void breaker_failureEndingWhileOpen_extendsOpenUntil() {
			fail(2);
			// 차단 전에 시작한 요청이 응답을 기다리는 동안 다른 요청이 차단을 열고, 20초 뒤 이 요청이 실패로 끝난다.
			assertThat(call(() -> {
				fail(1);
				clock.advance(Duration.ofSeconds(20));
				return status(HttpStatus.INTERNAL_SERVER_ERROR).get();
			})).isEmpty();

			clock.advance(Duration.ofSeconds(29));
			skipped();
			clock.advance(Duration.ofSeconds(1));
			succeed();
		}

		@Test
		@DisplayName("차단기_차단중에끝난성공은_차단을풀고INFO를남긴다")
		void breaker_successEndingWhileOpen_closes(CapturedOutput output) {
			fail(2);
			assertThat(call(() -> {
				fail(1);
				return ok().get();
			})).isPresent();
			assertThat(output.getAll()).contains("INFO").contains("AI search circuit closed");

			succeed();
		}

		static Reply busy() {
			return () -> {
				MockClientHttpResponse response = new MockClientHttpResponse(BUSY.getBytes(StandardCharsets.UTF_8),
						HttpStatus.SERVICE_UNAVAILABLE);
				response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
				return response;
			};
		}

		static IOException newInstance(Class<? extends IOException> type) {
			try {
				return type.getConstructor(String.class).newInstance("x");
			} catch (ReflectiveOperationException e) {
				throw new IllegalStateException(e);
			}
		}
	}

	/** 차단기 시각을 옮길 수 있는 시계 */
	static final class MutableClock extends java.time.Clock {

		private Instant now;

		MutableClock(Instant now) {
			this.now = now;
		}

		void advance(Duration duration) {
			now = now.plus(duration);
		}

		@Override
		public ZoneId getZone() {
			return ZoneId.of("UTC");
		}

		@Override
		public java.time.Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return now;
		}
	}

}
