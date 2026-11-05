package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
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
import kr.co.fitdining.api.place.dto.PlaceCard.ReasonTag;
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

	/** 예산 8초에 운영과 같은 재시도·자리 값. MockRestServiceServer는 시간이 흐르지 않아 예산이 줄지 않는다. */
	static final AiSearchClient.Timing TIMING = new AiSearchClient.Timing(Duration.ofSeconds(8),
			AiSearchClient.MIN_RETRY_TIME, AiSearchClient.MAX_RETRY_AFTER, AiSearchClient.SLOT_WAIT);

	final MutableClock clock = new MutableClock(Instant.parse("2026-10-31T03:00:00Z"));
	/** 실제로 쉬지 않고 쉬라고 한 시간만 남긴다 */
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

			assertThat(client().search(request("근처 맛집"), null)).isPresent();
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

			client().search(request, "user-1");
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

			client().search(new PlaceSearchRequest("카페", preferences, null, null, null), null);
		}

		@Test
		@DisplayName("AI요청_비회원답변의빈값은_null은빼고빈목록은그대로보낸다")
		void request_guestPreferencesEmptyValues_dropsNullsKeepsEmptyLists() {
			server.expect(requestTo(URL))
					.andExpect(content().string("""
							{"query":"카페","tasteProfile":{"priorities":[],"purposes":[],\
							"tastes":[{"polarity":"LIKE","label":"창가 자리"}]}}"""))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(new PlaceSearchRequest("카페", new Preferences(null, null, null,
					List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "창가 자리"))), null, null, null), null);
		}

		@Test
		@DisplayName("AI요청_빈이전조건과빈지도영역은_빼고null로도넣지않는다")
		void request_emptyPreviousAndBounds_omitted() {
			server.expect(requestTo(URL))
					.andExpect(content().string("{\"query\":\"카페\"}"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client().search(new PlaceSearchRequest("카페", null, Map.of(), new MapBounds(null, null, null, null), null),
					null);
		}

		@Test
		@DisplayName("AI요청_Modal키와비밀이있으면_헤더로싣는다")
		void request_modalCredentials_sentAsHeaders() {
			server.expect(requestTo(URL)).andExpect(header("Modal-Key", "key")).andExpect(header("Modal-Secret", "secret"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client("http://ai.test", "key", "secret").search(request("카페"), null);
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "   "})
		@DisplayName("AI요청_Modal키와비밀이비었거나공백뿐이면_헤더가없다")
		void request_blankModalCredentials_noHeaders(String blank) {
			server.expect(requestTo(URL)).andExpect(headerDoesNotExist("Modal-Key"))
					.andExpect(headerDoesNotExist("Modal-Secret"))
					.andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			client("http://ai.test", blank, blank).search(request("카페"), null);
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
					   "reasons":[{"title":"제목","tags":[{"source":"REQUEST","label":"조용해요"}],"quote":"q","quoteSource":"앱 리뷰"}],
					   "scoreItems":[{"source":"PREFERENCE","label":"넓어요","matched":false,"evidenceCount":0}]}],
					 "fallbacks":["PREVIOUS_INVALID","TASTE_INVALID"],"interpretedBy":"RULE","rankedBy":"SIMILARITY",
					 "models":{"embedding":"e"}}""", MediaType.APPLICATION_JSON));

			AiSearchClient.Response response = client().search(request("카페"), null).orElseThrow();

			assertThat(response.conditions()).containsEntry("text", "t").containsEntry("station", null);
			assertThat(response.nearby()).isTrue();
			assertThat(response.changeSummary()).isEqualTo("넓은 곳");
			assertThat(response.emptyReason().cause()).isEqualTo("c");
			assertThat(response.fallbacks()).containsExactly("PREVIOUS_INVALID", "TASTE_INVALID");
			AiSearchClient.Item item = response.items().getFirst();
			assertThat(item.placeId()).isEqualTo(7L);
			assertThat(item.score()).isEqualTo(91);
			assertThat(item.labels()).containsExactly("조용해요");
			assertThat(item.reasons()).containsExactly(new Reason("제목",
					List.of(new ReasonTag(EvidenceSource.REQUEST, "조용해요")), "q", "앱 리뷰"));
			assertThat(item.scoreItems()).containsExactly(new ScoreItem(EvidenceSource.PREFERENCE, "넓어요", false, 0));
		}

		@Test
		@DisplayName("AI응답_어느깊이든모르는속성과빠진값은_무시하고읽는다")
		void response_unknownPropertiesAnywhere_ignored() {
			server.expect(requestTo(URL)).andRespond(withSuccess("""
					{"items":[{"placeId":1,"extra":1,"reasons":[{"title":"t","tags":[{"source":"REQUEST","label":"l","x":2}],"y":3}],
					  "scoreItems":[{"source":"REQUEST","label":"l","z":[1]}]}],"newTop":{"a":1},
					 "interpretedBy":{"any":[1]},"rankedBy":3,"models":"text"}""", MediaType.APPLICATION_JSON));

			AiSearchClient.Response response = client().search(request("카페"), null).orElseThrow();

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
			assertThat(client(blank, "", "").search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("base-url is blank");
		}

		@Test
		@DisplayName("AI실패_형식이잘못된주소는_ERROR로대체한다")
		void failure_malformedBaseUrl_logsError(CapturedOutput output) {
			assertThat(client("http://ai test", "", "").search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID");
		}

		@Test
		@DisplayName("AI실패_형식이잘못된주소로빈을만들어도_생성은실패하지않고검색은대체한다")
		void failure_malformedBaseUrlInBeanConstructor_constructsAndFallsBack(CapturedOutput output) {
			// 스프링이 쓰는 생성자다. 여기서 주소를 해석하면 기동이 실패한다(AC-7 ⑦).
			AiSearchClient bean = new AiSearchClient("http://ai test", "", "", Optional.empty());

			assertThat(bean.search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID");
		}

		@ParameterizedTest
		@ValueSource(classes = {UnknownHostException.class, ConnectException.class, IOException.class})
		@DisplayName("AI실패_연결실패는_WARN이다")
		void failure_connection_logsWarn(Class<? extends IOException> type, CapturedOutput output) throws Exception {
			server.expect(requestTo(URL)).andRespond(withException(type.getConstructor(String.class).newInstance(SECRET)));

			assertThat(client().search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=CONNECTION").contains(type.getSimpleName())
					.doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_시간초과는_WARN이다")
		void failure_timeout_logsWarn(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withException(new SocketTimeoutException(SECRET)));

			assertThat(client().search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=TIMEOUT").doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(ints = {500, 502, 503, 504})
		@DisplayName("AI실패_BUSY가아닌5xx는_다시부르지않고WARN이다")
		void failure_serverError_noRetryAndWarn(int status, CapturedOutput output) {
			server.expect(ExpectedCount.once(), requestTo(URL))
					.andRespond(withStatus(HttpStatusCode.valueOf(status)).body("{\"code\":\"OTHER\",\"detail\":\"" + SECRET + "\"}")
							.contentType(MediaType.APPLICATION_JSON));

			assertThat(client().search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=SERVER_ERROR").contains("reason=" + status)
					.doesNotContain(SECRET);
		}

		@ParameterizedTest
		@ValueSource(ints = {400, 401, 404, 422, 302, 201, 204})
		@DisplayName("AI실패_200이아닌그밖의상태는_ERROR다")
		void failure_otherStatus_logsError(int status, CapturedOutput output) {
			server.expect(ExpectedCount.once(), requestTo(URL))
					.andRespond(withStatus(HttpStatusCode.valueOf(status)).body(SECRET));

			assertThat(client().search(request("카페"), null)).isEmpty();
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
				"{\"items\":[{\"placeId\":1,\"reasons\":[{\"title\":\"비밀표식9c41\",\"tags\":[null]}]}]}",
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

			assertThat(client().search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("kind=INVALID").doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_그밖의예외는_ERROR로대체한다")
		void failure_unexpectedException_logsError(CapturedOutput output) {
			AiSearchClient failing = new AiSearchClient("http://ai.test", "", "", TIMING, clock,
					timeout -> {
						throw new IllegalStateException(SECRET);
					}, slept::add);

			assertThat(failing.search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("ERROR").contains("IllegalStateException").doesNotContain(SECRET);
		}

		@Test
		@DisplayName("AI실패_요청본문과질의는_로그에없다")
		void failure_requestValues_notLogged(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.BAD_REQUEST));

			client().search(new PlaceSearchRequest(SECRET, null, Map.of("text", SECRET), null, null), "user-1");

			assertThat(output.getAll()).doesNotContain(SECRET);
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
		@DisplayName("BUSY_한번오면_RetryAfter만큼쉬고다시불러성공한다")
		void busy_once_waitsRetryAfterAndSucceeds() {
			expectBusy("1");
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(request("카페"), null)).isPresent();
			assertThat(slept).containsExactly(Duration.ofSeconds(1));
		}

		@Test
		@DisplayName("BUSY_RetryAfter가상한보다길면_상한만큼만쉰다")
		void busy_longRetryAfter_waitsAtMostTheCap() {
			expectBusy("30");
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(request("카페"), null)).isPresent();
			assertThat(slept).containsExactly(AiSearchClient.MAX_RETRY_AFTER);
		}

		@ParameterizedTest
		@ValueSource(strings = {"", "0", "-1", "1.5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT"})
		@DisplayName("BUSY_RetryAfter가초숫자가아니면_쉬지않고다시부른다")
		void busy_unreadableRetryAfter_retriesWithoutWaiting(String retryAfter) {
			expectBusy(retryAfter);
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(request("카페"), null)).isPresent();
			assertThat(slept).isEmpty();
		}

		@Test
		@DisplayName("BUSY_RetryAfter가없으면_쉬지않고다시부른다")
		void busy_noRetryAfter_retriesWithoutWaiting() {
			expectBusy(null);
			server.expect(requestTo(URL)).andRespond(withSuccess(OK, MediaType.APPLICATION_JSON));

			assertThat(client().search(request("카페"), null)).isPresent();
			assertThat(slept).isEmpty();
		}

		@Test
		@DisplayName("BUSY_쉰뒤남을예산이최소처리시간보다적으면_쉬지않고BUSY실패다")
		void busy_notEnoughBudgetAfterWait_failsWithoutWaiting(CapturedOutput output) {
			// 예산 8초에서 1초를 쉬면 7초가 남아 최소 처리 시간 7.5초보다 적다
			AiSearchClient client = new AiSearchClient("http://ai.test", "", "", new AiSearchClient.Timing(
					Duration.ofSeconds(8), Duration.ofMillis(7500), AiSearchClient.MAX_RETRY_AFTER,
					AiSearchClient.SLOT_WAIT), clock, timeout -> rest, slept::add);
			expectBusy("1");

			assertThat(client.search(request("카페"), null)).isEmpty();
			assertThat(slept).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=BUSY");
		}

		@Test
		@DisplayName("BUSY_쉬는동안중단되면_다시부르지않고차단기에세지않는다")
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
					assertThat(client.search(request("카페"), null)).isEmpty();
					assertThat(Thread.interrupted()).isTrue();
				}
				assertThat(client.search(request("카페"), null)).isPresent();
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

			assertThat(client().search(request("카페"), null)).isEmpty();
			assertThat(output.getAll()).contains("WARN").contains("kind=BUSY");
		}

		@Test
		@DisplayName("BUSY_재시도가다른실패면_그실패다")
		void busy_thenServerError_isServerError(CapturedOutput output) {
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE).body(BUSY)
					.contentType(MediaType.APPLICATION_PROBLEM_JSON));
			server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));

			assertThat(client().search(request("카페"), null)).isEmpty();
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
			return client.search(request("카페"), null);
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
			assertThat(client.search(request("카페"), null)).isEmpty();
			assertThat(calls).isEqualTo(before);
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
			assertThat(output.getAll()).contains("AI search circuit closed");
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
				assertThat(client.search(request("카페"), null)).isEmpty();
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
