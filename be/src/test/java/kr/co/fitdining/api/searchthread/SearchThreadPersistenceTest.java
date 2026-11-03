package kr.co.fitdining.api.searchthread;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.IntStream;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL(Testcontainers)과 마이그레이션, {@code RANDOM_PORT} HTTP로 검색 기록 API를 확인한다(search-thread D-16).
 * 컨테이너는 다른 통합 테스트와 함께 쓰므로 이 테스트가 만든 사용자와 그 기록은 앞뒤로 지운다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(OutputCaptureExtension.class)
class SearchThreadPersistenceTest extends PostgresTestSupport {

	private static final String USER_PREFIX = "thread-test-";
	private static final String PASSWORD = "thread-test-password1";
	private static final String BASE = "/api/v1/me/search-threads";
	private static final long AT = 1_761_700_000_000L;
	private static final String INVALID = "urn:fitdining:search-thread:invalid";
	private static final String CONFLICT = "urn:fitdining:search-thread:conflict";
	private static final String BASE_MISSING = "urn:fitdining:search-thread:base-missing";
	private static final String NOT_FOUND = "urn:fitdining:search-thread:not-found";

	/** 숫자를 10진 값으로 읽어 {@code 0.1}이나 큰 정수가 double을 거치지 않게 한다. */
	private final JsonMapper mapper = JsonMapper.builder()
			.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS, DeserializationFeature.USE_BIG_INTEGER_FOR_INTS)
			.build();
	private final HttpClient client = HttpClient.newHttpClient();

	@Autowired
	AuthUserRepository users;

	@Autowired
	AuthUseCases auth;

	@Autowired
	PasswordHasher passwords;

	@Autowired
	UserService userService;

	@Value("${local.server.port}")
	int port;

	/** 브라우저는 DELETE에 Origin을 붙이고, 인증 모듈의 웹 설정이 FE 출처인지 확인한다 */
	@Value("${auth.frontend-origin}")
	String origin;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
	}

	@AfterEach
	void cleanUp() {
		JdbcTemplate app = new JdbcTemplate(appSource());
		app.update("delete from search_threads where user_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_refresh_tokens where user_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_users where id like ?", USER_PREFIX + "%");
		app.update("delete from auth_login_attempts where address like ?", USER_PREFIX + "%");
	}

	/** n번 사용자를 만들고 로그인한 AT를 돌려준다. */
	private String signIn(int n) {
		users.save(new AuthUser(USER_PREFIX + n, USER_PREFIX + n + "@example.com", "기록테스트" + n,
				passwords.hash(PASSWORD), Instant.parse("2026-10-20T00:00:00Z"), "2026-10-23"));
		// 로그인 시도 제한은 주소별이라 로그인마다 다른 주소로 보낸다
		return auth.login(USER_PREFIX + n + "@example.com", PASSWORD, USER_PREFIX + UUID.randomUUID()).accessToken();
	}

	private void withdraw(int n) {
		String userId = USER_PREFIX + n;
		userService.withdraw(userId, new AuthUseCases.Identity(userId, null, null, 0, 0));
	}

	private static String threadId() {
		return "thread-" + UUID.randomUUID();
	}

	private static String turnId() {
		return "entry-" + UUID.randomUUID();
	}

	private static String quote(String value) {
		return JsonMapper.builder().build().writeValueAsString(value);
	}

	/** 결과가 없는 첫 페이지 응답과 질문만 있는 요청의 turn */
	private static String turn(String id, String kind, String baseId, long at, String query) {
		return "{\"id\":\"" + id + "\",\"kind\":\"" + kind + "\""
				+ (baseId == null ? "" : ",\"baseId\":\"" + baseId + "\"")
				+ ",\"at\":" + at + ",\"request\":{\"query\":" + quote(query) + "},"
				+ "\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}";
	}

	private static String newTurn(String id, long at, String query) {
		return turn(id, "new", null, at, query);
	}

	private HttpResponse<String> send(String method, String path, String token, String body) throws Exception {
		return client.send(request(method, path, token, body), HttpResponse.BodyHandlers.ofString());
	}

	private HttpRequest request(String method, String path, String token, String body) {
		HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
		if (token != null) {
			builder.header("Authorization", "Bearer " + token);
		}
		if (body != null) {
			builder.header("Content-Type", "application/json");
		}
		if (method.equals("DELETE")) {
			builder.header("Origin", origin);
		}
		return builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
				: HttpRequest.BodyPublishers.ofString(body)).build();
	}

	private HttpResponse<String> put(String token, String thread, String turn, String body) throws Exception {
		return send("PUT", BASE + "/" + thread + "/turns/" + turn, token, body);
	}

	private JsonNode getThread(String token, String thread) throws Exception {
		HttpResponse<String> response = send("GET", BASE + "/" + thread, token, null);
		assertThat(response.statusCode()).isEqualTo(200);
		return mapper.readTree(response.body());
	}

	private JsonNode list(String token, String cursor) throws Exception {
		HttpResponse<String> response = send("GET", BASE + (cursor == null ? "" : "?cursor=" + cursor), token, null);
		assertThat(response.statusCode()).isEqualTo(200);
		return mapper.readTree(response.body());
	}

	private String type(HttpResponse<String> response) {
		JsonNode type = mapper.readTree(response.body()).get("type");
		return type == null ? null : type.asString();
	}

	private List<String> turnIds(JsonNode thread) {
		List<String> ids = new ArrayList<>();
		thread.get("turns").values().forEach(turn -> ids.add(turn.get("id").asString()));
		return ids;
	}

	private int count(String table) {
		return jdbc.queryForObject("select count(*) from " + table + " where user_id like ?", Integer.class,
				USER_PREFIX + "%");
	}

	/** n번 사용자의 행 수 */
	private int countOf(int n, String table) {
		return jdbc.queryForObject("select count(*) from " + table + " where user_id = ?", Integer.class,
				USER_PREFIX + n);
	}

	@Nested
	@DisplayName("저장")
	class Save {

		@Test
		@DisplayName("추가_thread의첫new면_thread를만들고204이며_다시읽으면baseId키없이그대로다")
		void put_firstNew_createsThread() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();

			HttpResponse<String> saved = put(token, thread, first, newTurn(first, AT, "조용한 카페"));

			assertThat(saved.statusCode()).isEqualTo(204);
			assertThat(saved.body()).isEmpty();
			JsonNode read = getThread(token, thread);
			assertThat(read.get("id").asString()).isEqualTo(thread);
			JsonNode turn = read.get("turns").get(0);
			assertThat(turn.propertyNames()).containsExactlyInAnyOrder("id", "kind", "at", "request", "response");
			assertThat(turn.get("kind").asString()).isEqualTo("new");
			assertThat(turn.get("at").longValue()).isEqualTo(AT);
			assertThat(turn.get("request")).isEqualTo(mapper.readTree("{\"query\":\"조용한 카페\"}"));
		}

		@Test
		@DisplayName("추가_같은turn을키순서만바꿔다시보내도_204이고한번만저장된다")
		void put_resendWithOtherKeyOrder_storedOnce() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "조용한 카페"));
			String reordered = "{\"response\":{\"conditions\":{},\"totalCount\":0,\"items\":[]},"
					+ "\"request\":{\"query\":\"조용한 카페\"},\"at\":" + AT + ",\"kind\":\"new\",\"id\":\"" + first + "\"}";

			assertThat(put(token, thread, first, reordered).statusCode()).isEqualTo(204);
			assertThat(put(token, thread, first, newTurn(first, AT, "조용한 카페")).statusCode()).isEqualTo(204);

			assertThat(turnIds(getThread(token, thread))).containsExactly(first);
			assertThat(count("search_thread_turns")).isEqualTo(1);
		}

		@Test
		@DisplayName("추가_같은id를다른내용으로보내면_409conflict이고저장된것은그대로다")
		void put_sameIdOtherContent_conflictKeepsStored() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "조용한 카페"));

			HttpResponse<String> conflict = put(token, thread, first, newTurn(first, AT + 1, "조용한 카페"));

			assertThat(conflict.statusCode()).isEqualTo(409);
			assertThat(type(conflict)).isEqualTo(CONFLICT);
			JsonNode read = getThread(token, thread);
			assertThat(read.get("turns").get(0).get("at").longValue()).isEqualTo(AT);
			assertThat(list(token, null).get("items").get(0).get("lastAt").longValue()).isEqualTo(AT);
		}

		/** 시각과 종류는 같고 요청(request)이나 응답(response)만 다르다 */
		@ParameterizedTest
		@ValueSource(strings = {"request", "response"})
		@DisplayName("추가_같은id와시각에요청이나응답만다르면_409conflict이고저장된것은그대로다")
		void put_sameIdOtherSnapshot_conflictKeepsStored(String changed) throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			String stored = newTurn(first, AT, "조용한 카페");
			put(token, thread, first, stored);
			String other = changed.equals("request") ? newTurn(first, AT, "시끄러운 카페")
					: stored.replace("\"totalCount\":0", "\"totalCount\":1");

			HttpResponse<String> conflict = put(token, thread, first, other);

			assertThat(conflict.statusCode()).isEqualTo(409);
			assertThat(type(conflict)).isEqualTo(CONFLICT);
			assertThat(getThread(token, thread).get("turns").get(0)).isEqualTo(mapper.readTree(stored));
		}

		@Test
		@DisplayName("추가_안쪽null빈객체모르는필드와숫자10진값이_다시읽어도JSON값으로같다")
		void put_snapshot_keepsJsonValues() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			String second = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			String request = "{\"query\":\"더 조용하게\",\"previousConditions\":{\"area\":null,\"mood\":{},"
					+ "\"tags\":[null,{}]},\"mapBounds\":{\"swLat\":37.49,\"swLng\":0.1}}";
			String response = "{\"items\":[{\"place\":{\"id\":1,\"lat\":37.5006,\"lng\":127.0364},\"score\":0.1,"
					+ "\"unknownField\":{\"nested\":null}}],\"totalCount\":32,\"conditions\":{\"area\":null,\"quiet\":true,"
					+ "\"price\":{}},\"changeSummary\":null,\"huge\":1e21,\"big\":123456789012345678901234567890,"
					+ "\"tiny\":0.30000000000000004}";
			String body = "{\"id\":\"" + second + "\",\"kind\":\"followUp\",\"baseId\":\"" + first + "\",\"at\":"
					+ (AT + 1) + ",\"request\":" + request + ",\"response\":" + response + "}";

			assertThat(put(token, thread, second, body).statusCode()).isEqualTo(204);

			JsonNode stored = getThread(token, thread).get("turns").get(1);
			assertThat(stored.get("baseId").asString()).isEqualTo(first);
			assertThat(stored.get("request")).isEqualTo(mapper.readTree(request));
			assertThat(stored.get("response").get("items")).isEqualTo(mapper.readTree(response).get("items"));
			assertThat(stored.get("response").get("conditions")).isEqualTo(mapper.readTree(response).get("conditions"));
			assertThat(stored.get("response").get("changeSummary").isNull()).isTrue();
			// jsonb는 1e21을 다른 표기로 돌려주므로 텍스트가 아니라 10진 값으로 비교한다
			assertThat(stored.get("response").get("huge").decimalValue()).isEqualByComparingTo(new BigDecimal("1e21"));
			assertThat(stored.get("response").get("big").decimalValue())
					.isEqualByComparingTo(new BigDecimal("123456789012345678901234567890"));
			assertThat(stored.get("response").get("tiny").decimalValue())
					.isEqualByComparingTo(new BigDecimal("0.30000000000000004"));
			assertThat(stored.get("response").get("items").get(0).get("score").decimalValue())
					.isEqualByComparingTo(new BigDecimal("0.1"));
		}

		@Test
		@DisplayName("추가_turn이많아도_제한없이모두저장한다")
		void put_manyTurns_noLimit() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			List<String> ids = new ArrayList<>(List.of(first));
			for (int i = 1; i < 60; i++) {
				String id = turnId();
				assertThat(put(token, thread, id, turn(id, "followUp", ids.getLast(), AT + i, "조건 " + i))
						.statusCode()).isEqualTo(204);
				ids.add(id);
			}

			assertThat(turnIds(getThread(token, thread))).containsExactlyElementsOf(ids);
		}
	}

	@Nested
	@DisplayName("thread 규칙과 판단 순서")
	class Rules {

		@Test
		@DisplayName("추가_같은id다른내용이면서thread규칙도어기면_409conflict가먼저다")
		void put_sameIdBreakingThreadRule_conflictFirst() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));

			// baseId 없는 followUp은 thread 규칙 위반(400)이지만, 같은 id 비교가 먼저다
			HttpResponse<String> response = put(token, thread, first, turn(first, "followUp", null, AT, "카페"));

			assertThat(response.statusCode()).isEqualTo(409);
			assertThat(type(response)).isEqualTo(CONFLICT);
		}

		@Test
		@DisplayName("추가_없는thread의followUp은_400이고thread를만들지않는다")
		void put_followUpOnMissingThread_invalid() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String id = turnId();

			HttpResponse<String> response = put(token, thread, id, turn(id, "followUp", turnId(), AT, "카페"));

			assertThat(response.statusCode()).isEqualTo(400);
			assertThat(type(response)).isEqualTo(INVALID);
			assertThat(count("search_threads")).isZero();
		}

		/** base: none(baseId 없음), first(첫 turn), self(자기 자신) */
		@ParameterizedTest
		@CsvSource({"followUp, none", "region, none", "new, first", "followUp, self"})
		@DisplayName("추가_baseId없는followUp_region_baseId있는new_자기자신을가리키는baseId는_400이다")
		void put_threadRuleViolation_invalid(String kind, String base) throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			String id = turnId();
			String baseId = switch (base) {
				case "first" -> first;
				case "self" -> id;
				default -> null;
			};

			HttpResponse<String> response = put(token, thread, id, turn(id, kind, baseId, AT, "조건"));

			assertThat(response.statusCode()).isEqualTo(400);
			assertThat(type(response)).isEqualTo(INVALID);
			assertThat(turnIds(getThread(token, thread))).containsExactly(first);
		}

		@Test
		@DisplayName("추가_기준turn이아직없으면_409base-missing이고아무것도바뀌지않는다")
		void put_baseMissing_conflictNothingChanged() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			String id = turnId();

			HttpResponse<String> response = put(token, thread, id, turn(id, "region", turnId(), AT + 5, "카페"));

			assertThat(response.statusCode()).isEqualTo(409);
			assertThat(type(response)).isEqualTo(BASE_MISSING);
			assertThat(turnIds(getThread(token, thread))).containsExactly(first);
			assertThat(list(token, null).get("items").get(0).get("lastAt").longValue()).isEqualTo(AT);
		}

		@Test
		@DisplayName("추가_다른thread의turn을기준으로하면_409base-missing이다")
		void put_baseInOtherThread_baseMissing() throws Exception {
			String token = signIn(0);
			String other = threadId();
			String otherTurn = turnId();
			put(token, other, otherTurn, newTurn(otherTurn, AT, "다른"));
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			String id = turnId();

			HttpResponse<String> response = put(token, thread, id, turn(id, "followUp", otherTurn, AT, "카페"));

			assertThat(response.statusCode()).isEqualTo(409);
			assertThat(type(response)).isEqualTo(BASE_MISSING);
		}

		@Test
		@DisplayName("추가_이미있는thread의new는_이조건으로다시검색이라허용한다")
		void put_laterNew_allowed() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			String again = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));

			assertThat(put(token, thread, again, newTurn(again, AT + 1, "카페")).statusCode()).isEqualTo(204);
			assertThat(turnIds(getThread(token, thread))).containsExactly(first, again);
		}
	}

	@Nested
	@DisplayName("DB 제약")
	class Constraints {

		private void insertThread(String user, String thread) {
			jdbc.update("insert into search_threads (user_id, thread_id, title, last_requested_at, turn_count) "
					+ "values (?, ?, 't', now(), 0)", user, thread);
		}

		private void insertTurn(String user, String thread, String turn, int seq, String kind, String base) {
			jdbc.update("insert into search_thread_turns (user_id, thread_id, turn_id, seq, kind, base_turn_id, "
					+ "requested_at, request, response) values (?, ?, ?, ?, ?, ?, now(), '{}', '{}')",
					user, thread, turn, seq, kind, base);
		}

		private final String user = USER_PREFIX + 0;
		private String thread;
		private String first;

		@BeforeEach
		void seed() {
			signIn(0);
			thread = threadId();
			insertThread(user, thread);
			first = turnId();
			insertTurn(user, thread, first, 1, "new", null);
		}

		@Test
		@DisplayName("직접쓰기_다른thread의turn을baseId로가리키면_DB가거부한다")
		void directWrite_baseInOtherThread_rejected() {
			String other = threadId();
			insertThread(user, other);

			assertThatThrownBy(() -> insertTurn(user, other, turnId(), 1, "followUp", first))
					.isInstanceOf(DataIntegrityViolationException.class);
		}

		@Test
		@DisplayName("직접쓰기_baseId가자기자신이면_DB가거부한다")
		void directWrite_selfBase_rejected() {
			String self = turnId();

			assertThatThrownBy(() -> insertTurn(user, thread, self, 2, "followUp", self))
					.isInstanceOf(DataIntegrityViolationException.class);
		}

		@Test
		@DisplayName("직접쓰기_세값밖의종류면_DB가거부한다")
		void directWrite_unknownKind_rejected() {
			assertThatThrownBy(() -> insertTurn(user, thread, turnId(), 2, "other", null))
					.isInstanceOf(DataIntegrityViolationException.class);
		}
	}

	@Nested
	@DisplayName("동시성")
	class Concurrency {

		private List<HttpResponse<String>> all(List<HttpRequest> requests) {
			List<CompletableFuture<HttpResponse<String>>> futures = requests.stream()
					.map(request -> client.sendAsync(request, HttpResponse.BodyHandlers.ofString())).toList();
			return futures.stream().map(CompletableFuture::join).toList();
		}

		@Test
		@DisplayName("동시_같은thread의첫turn을여럿이만들어도_500없이thread하나에모두순서대로쌓인다")
		void put_concurrentFirstTurns_oneThreadAllStored() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			List<String> ids = IntStream.range(0, 8).mapToObj(i -> turnId()).toList();

			List<HttpResponse<String>> responses = all(ids.stream()
					.map(id -> request("PUT", BASE + "/" + thread + "/turns/" + id, token, newTurn(id, AT, "카페")))
					.toList());

			assertThat(responses).extracting(HttpResponse::statusCode).containsOnly(204);
			assertThat(count("search_threads")).isEqualTo(1);
			assertThat(turnIds(getThread(token, thread))).containsExactlyInAnyOrderElementsOf(ids);
			assertThat(jdbc.queryForList("select seq from search_thread_turns where user_id like ? order by seq",
					Integer.class, USER_PREFIX + "%")).containsExactly(1, 2, 3, 4, 5, 6, 7, 8);
		}

		@Test
		@DisplayName("동시_같은turn을여러번보내도_500없이한번만저장된다")
		void put_concurrentSameTurn_storedOnce() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String id = turnId();

			List<HttpResponse<String>> responses = all(IntStream.range(0, 8)
					.mapToObj(i -> request("PUT", BASE + "/" + thread + "/turns/" + id, token, newTurn(id, AT, "카페")))
					.toList());

			assertThat(responses).extracting(HttpResponse::statusCode).containsOnly(204);
			assertThat(count("search_thread_turns")).isEqualTo(1);
		}

		@Test
		@DisplayName("동시_다른turn을함께보내도_유실없이저장되고마지막요청시각은가장늦게저장된turn의at이다")
		void put_concurrentOtherTurns_allStored() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			List<String> ids = IntStream.range(0, 8).mapToObj(i -> turnId()).toList();

			List<HttpResponse<String>> responses = all(IntStream.range(0, ids.size())
					.mapToObj(i -> request("PUT", BASE + "/" + thread + "/turns/" + ids.get(i), token,
							turn(ids.get(i), "followUp", first, AT + 100 - i, "조건")))
					.toList());

			assertThat(responses).extracting(HttpResponse::statusCode).containsOnly(204);
			List<String> stored = turnIds(getThread(token, thread));
			assertThat(stored).hasSize(9).first().isEqualTo(first);
			long lastAt = AT + 100 - ids.indexOf(stored.getLast());
			assertThat(list(token, null).get("items").get(0).get("lastAt").longValue()).isEqualTo(lastAt);
		}

		@Test
		@DisplayName("동시_탈퇴와저장이함께와도_저장은204나401로끝나고탈퇴한회원의기록은남지않는다")
		void withdraw_concurrentSaves_leaveNoRecords() {
			String token = signIn(0);
			List<CompletableFuture<HttpResponse<String>>> saves = IntStream.range(0, 8).mapToObj(i -> {
				String id = turnId();
				return client.sendAsync(request("PUT", BASE + "/" + threadId() + "/turns/" + id, token,
						newTurn(id, AT + i, "카페")), HttpResponse.BodyHandlers.ofString());
			}).toList();

			CompletableFuture.runAsync(() -> withdraw(0)).join();

			assertThat(saves.stream().map(CompletableFuture::join).map(HttpResponse::statusCode))
					.allMatch(status -> status == 204 || status == 401);
			assertThat(countOf(0, "search_threads")).isZero();
			assertThat(countOf(0, "search_thread_turns")).isZero();
		}
	}

	@Nested
	@DisplayName("상한")
	class Limit {

		/** at이 하나씩 늦어지는 thread를 count개 만들고 만든 순서대로 id를 돌려준다 */
		private List<String> fill(String token, int count) throws Exception {
			List<String> threads = new ArrayList<>();
			for (int i = 0; i < count; i++) {
				String thread = threadId();
				String id = turnId();
				assertThat(put(token, thread, id, newTurn(id, AT + i, "질문 " + i)).statusCode()).isEqualTo(204);
				threads.add(thread);
			}
			return threads;
		}

		@Test
		@DisplayName("상한_새thread로상한을넘으면_마지막요청시각이가장오래된thread를turn까지지우고남의기록은남긴다")
		void put_newThreadOverLimit_removesOldest() throws Exception {
			String token = signIn(0);
			String theirs = signIn(1);
			String other = turnId();
			put(theirs, threadId(), other, newTurn(other, AT - 1, "남의 질문"));

			List<String> threads = fill(token, SearchThreadService.MAX_THREADS + 1);

			assertThat(send("GET", BASE + "/" + threads.getFirst(), token, null).statusCode()).isEqualTo(404);
			JsonNode items = list(token, null).get("items");
			assertThat(items).hasSize(SearchThreadService.MAX_THREADS);
			assertThat(items.get(0).get("id").asString()).isEqualTo(threads.getLast());
			assertThat(countOf(0, "search_thread_turns")).isEqualTo(SearchThreadService.MAX_THREADS);
			assertThat(countOf(1, "search_threads")).isEqualTo(1);
		}

		@Test
		@DisplayName("상한_있는thread에이어쓰면_개수가늘지않아지우지않는다")
		void put_followUpAtLimit_keepsAll() throws Exception {
			String token = signIn(0);
			List<String> threads = fill(token, SearchThreadService.MAX_THREADS);
			String oldest = threads.getFirst();
			String base = turnIds(getThread(token, oldest)).getFirst();
			String next = turnId();

			HttpResponse<String> response = put(token, oldest, next, turn(next, "followUp", base, AT + 100, "조건"));

			assertThat(response.statusCode()).isEqualTo(204);
			assertThat(countOf(0, "search_threads")).isEqualTo(SearchThreadService.MAX_THREADS);
			assertThat(list(token, null).get("items").get(0).get("id").asString()).isEqualTo(oldest);
		}

		@Test
		@DisplayName("상한_방금만든thread의at이가장오래돼도_그thread는남기고다른가장오래된thread를지운다")
		void put_newThreadWithPastAt_keepsIt() throws Exception {
			String token = signIn(0);
			List<String> threads = fill(token, SearchThreadService.MAX_THREADS);
			String past = threadId();
			String id = turnId();

			HttpResponse<String> response = put(token, past, id, newTurn(id, AT - 1_000, "과거 시각"));

			assertThat(response.statusCode()).isEqualTo(204);
			assertThat(getThread(token, past).get("turns")).hasSize(1);
			assertThat(send("GET", BASE + "/" + threads.getFirst(), token, null).statusCode()).isEqualTo(404);
			assertThat(countOf(0, "search_threads")).isEqualTo(SearchThreadService.MAX_THREADS);
		}

		@Test
		@DisplayName("상한_새thread를동시에여럿만들어도_500없이상한만큼남는다")
		void put_concurrentNewThreads_endsAtLimit() throws Exception {
			String token = signIn(0);
			fill(token, SearchThreadService.MAX_THREADS - 1);

			List<CompletableFuture<HttpResponse<String>>> futures = IntStream.range(0, 6).mapToObj(i -> {
				String id = turnId();
				return client.sendAsync(request("PUT", BASE + "/" + threadId() + "/turns/" + id, token,
						newTurn(id, AT + 100 + i, "동시 " + i)), HttpResponse.BodyHandlers.ofString());
			}).toList();

			assertThat(futures.stream().map(CompletableFuture::join).map(HttpResponse::statusCode)).containsOnly(204);
			assertThat(countOf(0, "search_threads")).isEqualTo(SearchThreadService.MAX_THREADS);
		}
	}

	@Nested
	@DisplayName("목록")
	class ListThreads {

		@Test
		@DisplayName("목록_at이거꾸로가도_제목은첫질문이고lastAt은마지막으로저장된turn의at이다")
		void list_atGoingBackward_usesLastStoredTurn() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			String second = turnId();
			put(token, thread, first, newTurn(first, AT, "첫 질문"));
			put(token, thread, second, turn(second, "followUp", first, AT - 60_000, "두 번째"));

			JsonNode item = list(token, null).get("items").get(0);

			assertThat(item.get("id").asString()).isEqualTo(thread);
			assertThat(item.get("title").asString()).isEqualTo("첫 질문");
			assertThat(item.get("lastAt").longValue()).isEqualTo(AT - 60_000);
		}

		@Test
		@DisplayName("목록_같은시각묶음이페이지경계를넘어도_thread_id역순으로빠짐과겹침없이이어진다")
		void list_tiesAcrossPageBoundary_continuesWithoutGapOrDuplicate() throws Exception {
			String token = signIn(0);
			// 다섯 개만 시각이 다르고 나머지는 같은 시각이라 같은 시각 묶음이 페이지 경계를 넘는다.
			// 상한(D-19)보다 많아야 하므로 상한 전에 쌓인 기록처럼 DB에 직접 넣는다. 목록은 turn을 읽지 않는다
			List<String> threads = IntStream.range(0, 21).mapToObj(i -> threadId()).toList();
			for (int i = 0; i < threads.size(); i++) {
				jdbc.update("insert into search_threads (user_id, thread_id, title, last_requested_at, turn_count)"
						+ " values (?, ?, ?, ?, 0)", USER_PREFIX + 0, threads.get(i), "질문 " + i,
						Timestamp.from(Instant.ofEpochMilli(i < 5 ? AT + 1000 + i : AT)));
			}
			List<String> expected = new ArrayList<>();
			for (int i = 4; i >= 0; i--) {
				expected.add(threads.get(i));
			}
			threads.subList(5, 21).stream().sorted((a, b) -> b.compareTo(a)).forEach(expected::add);

			JsonNode first = list(token, null);
			JsonNode second = list(token, first.get("nextCursor").asString());

			List<String> ids = new ArrayList<>();
			first.get("items").values().forEach(item -> ids.add(item.get("id").asString()));
			assertThat(ids).hasSize(20);
			second.get("items").values().forEach(item -> ids.add(item.get("id").asString()));
			assertThat(ids).containsExactlyElementsOf(expected);
			assertThat(second.has("nextCursor")).isFalse();
			assertThat(list(token, null)).isEqualTo(first);
		}

		@Test
		@DisplayName("목록_딱20개면_nextCursor가없다")
		void list_exactlyTwenty_noCursor() throws Exception {
			String token = signIn(0);
			for (int i = 0; i < 20; i++) {
				String id = turnId();
				put(token, threadId(), id, newTurn(id, AT + i, "질문"));
			}

			JsonNode page = list(token, null);

			assertThat(page.get("items")).hasSize(20);
			assertThat(page.has("nextCursor")).isFalse();
		}

		@Test
		@DisplayName("목록_기록이없으면_빈목록이다")
		void list_noThreads_emptyItems() throws Exception {
			String token = signIn(0);

			assertThat(list(token, null)).isEqualTo(mapper.readTree("{\"items\":[]}"));
		}

		@ParameterizedTest
		// 마지막 둘은 형식은 맞지만 시각이 JS Date 상한(8.64e15)을 넘는 위조 cursor다(long 최댓값, 상한 + 1)
		@ValueSource(strings = {"not-a-cursor", "YWJj", "MTIzfHRocmVhZC14", "%3D%3D",
				"OTIyMzM3MjAzNjg1NDc3NTgwN3x0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1",
				"ODY0MDAwMDAwMDAwMDAwMXx0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1"})
		@DisplayName("목록_형식이틀린cursor는_400이다")
		void list_badCursor_invalid(String cursor) throws Exception {
			String token = signIn(0);

			HttpResponse<String> response = send("GET", BASE + "?cursor=" + cursor, token, null);

			assertThat(response.statusCode()).isEqualTo(400);
			assertThat(type(response)).isEqualTo(INVALID);
		}
	}

	@Nested
	@DisplayName("주인")
	class Owner {

		@Test
		@DisplayName("주인_두계정이같은id로저장해도_각자의thread이고남의것은읽을수없다")
		void put_sameIdsOnTwoAccounts_storedSeparately() throws Exception {
			String mine = signIn(0);
			String theirs = signIn(1);
			String thread = threadId();
			String id = turnId();
			put(mine, thread, id, newTurn(id, AT, "내 질문"));

			assertThat(send("GET", BASE + "/" + thread, theirs, null).statusCode()).isEqualTo(404);
			assertThat(list(theirs, null).get("items")).isEmpty();
			assertThat(put(theirs, thread, id, newTurn(id, AT + 1, "남의 질문")).statusCode()).isEqualTo(204);

			assertThat(getThread(mine, thread).get("turns").get(0).get("request").get("query").asString())
					.isEqualTo("내 질문");
			assertThat(getThread(theirs, thread).get("turns").get(0).get("request").get("query").asString())
					.isEqualTo("남의 질문");
		}

		@Test
		@DisplayName("읽기_내계정에없는thread면_404다")
		void get_missingThread_notFound() throws Exception {
			String token = signIn(0);

			HttpResponse<String> missing = send("GET", BASE + "/" + threadId(), token, null);

			assertThat(missing.statusCode()).isEqualTo(404);
			assertThat(type(missing)).isEqualTo(NOT_FOUND);
		}

		@Test
		@DisplayName("읽기_형식이틀린thread_id면_400이다")
		void get_badThreadId_invalid() throws Exception {
			String token = signIn(0);

			HttpResponse<String> bad = send("GET", BASE + "/thread-ABC", token, null);

			assertThat(bad.statusCode()).isEqualTo(400);
			assertThat(type(bad)).isEqualTo(INVALID);
		}
	}

	@Nested
	@DisplayName("지우기")
	class Delete {

		@Test
		@DisplayName("지우기_thread하나를지우면_204이고그turn까지지워지며다른thread는남는다")
		void delete_oneThread_removesItsTurnsOnly() throws Exception {
			String token = signIn(0);
			String gone = threadId();
			String first = turnId();
			String second = turnId();
			put(token, gone, first, newTurn(first, AT, "카페"));
			put(token, gone, second, turn(second, "followUp", first, AT + 1, "조용한 곳"));
			String kept = threadId();
			String other = turnId();
			put(token, kept, other, newTurn(other, AT, "식당"));

			HttpResponse<String> deleted = send("DELETE", BASE + "/" + gone, token, null);

			assertThat(deleted.statusCode()).isEqualTo(204);
			assertThat(deleted.body()).isEmpty();
			assertThat(send("GET", BASE + "/" + gone, token, null).statusCode()).isEqualTo(404);
			assertThat(list(token, null).get("items").values()).extracting(item -> item.get("id").asString())
					.containsExactly(kept);
			assertThat(count("search_thread_turns")).isEqualTo(1);
		}

		@Test
		@DisplayName("지우기_지운thread에이어서보내면_첫turn규칙에걸려400이고되살아나지않는다")
		void delete_followUpAfterDelete_invalid() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			send("DELETE", BASE + "/" + thread, token, null);
			String next = turnId();

			HttpResponse<String> response = put(token, thread, next, turn(next, "followUp", first, AT + 1, "조건"));

			assertThat(response.statusCode()).isEqualTo(400);
			assertThat(count("search_threads")).isZero();
		}

		@Test
		@DisplayName("지우기_내계정에없는thread여도_204다")
		void delete_missingThread_noContent() throws Exception {
			String token = signIn(0);

			assertThat(send("DELETE", BASE + "/" + threadId(), token, null).statusCode()).isEqualTo(204);
		}

		@Test
		@DisplayName("지우기_남의thread와같은id로지워도_남의기록은그대로다")
		void delete_sameIdOnOtherAccount_keepsTheirs() throws Exception {
			String mine = signIn(0);
			String theirs = signIn(1);
			String thread = threadId();
			String id = turnId();
			put(theirs, thread, id, newTurn(id, AT, "남의 질문"));

			assertThat(send("DELETE", BASE + "/" + thread, mine, null).statusCode()).isEqualTo(204);

			assertThat(getThread(theirs, thread).get("turns")).hasSize(1);
		}

		@Test
		@DisplayName("전체지우기_내기록만모두지우고_남의기록은남는다")
		void deleteAll_removesOnlyMine() throws Exception {
			String mine = signIn(0);
			String theirs = signIn(1);
			for (int i = 0; i < 2; i++) {
				String id = turnId();
				put(mine, threadId(), id, newTurn(id, AT + i, "내 질문" + i));
			}
			String theirThread = threadId();
			String theirTurn = turnId();
			put(theirs, theirThread, theirTurn, newTurn(theirTurn, AT, "남의 질문"));

			HttpResponse<String> deleted = send("DELETE", BASE, mine, null);

			assertThat(deleted.statusCode()).isEqualTo(204);
			assertThat(list(mine, null).get("items")).isEmpty();
			assertThat(list(theirs, null).get("items")).hasSize(1);
			assertThat(count("search_thread_turns")).isEqualTo(1);
		}

		@Test
		@DisplayName("지우기_요청출처가FE가아니면_403이고지우지않는다")
		void delete_otherOrigin_forbidden() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String id = turnId();
			put(token, thread, id, newTurn(id, AT, "카페"));
			HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + BASE))
					.header("Authorization", "Bearer " + token).header("Origin", "https://evil.example")
					.DELETE().build();

			HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

			assertThat(response.statusCode()).isEqualTo(403);
			assertThat(count("search_threads")).isEqualTo(1);
		}

		@Test
		@DisplayName("지우기_형식이틀린thread_id면_400이다")
		void delete_badThreadId_invalid() throws Exception {
			String token = signIn(0);

			HttpResponse<String> bad = send("DELETE", BASE + "/thread-ABC", token, null);

			assertThat(bad.statusCode()).isEqualTo(400);
			assertThat(type(bad)).isEqualTo(INVALID);
		}
	}

	@Nested
	@DisplayName("인증")
	class Authentication {

		/** 토큰이 없거나(none) 서명이 틀린(forged) 요청 */
		@ParameterizedTest
		@CsvSource({"list, none", "list, forged", "thread, none", "thread, forged", "turn, none", "turn, forged",
				"delete, none", "delete, forged", "deleteAll, none", "deleteAll, forged"})
		@DisplayName("인증_토큰이없거나틀리면_다섯API모두401이다")
		void anyApi_noOrBadToken_unauthorized(String api, String token) throws Exception {
			String bearer = token.equals("none") ? null : token;
			String thread = threadId();
			String id = turnId();

			HttpResponse<String> response = switch (api) {
				case "list" -> send("GET", BASE, bearer, null);
				case "thread" -> send("GET", BASE + "/" + thread, bearer, null);
				case "delete" -> send("DELETE", BASE + "/" + thread, bearer, null);
				case "deleteAll" -> send("DELETE", BASE, bearer, null);
				default -> put(bearer, thread, id, newTurn(id, AT, "카페"));
			};

			assertThat(response.statusCode()).isEqualTo(401);
		}

		/** 탈퇴 전에 thread 하나와 turn 하나를 저장해 둔다. 이 밖의 판단(404, 400, 409)보다 401이 먼저다 */
		@ParameterizedTest
		@ValueSource(strings = {"list", "badCursor", "storedThread", "missingThread", "badThreadId", "brokenBody",
				"followUp", "delete", "deleteBadId", "deleteAll"})
		@DisplayName("인증_탈퇴한사용자는_목록_틀린cursor_있는thread_없는thread_틀린id_깨진본문_정상추가_지우기모두401이다")
		void anyApi_withdrawnUser_unauthorizedFirst(String request) throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String id = turnId();
			put(token, thread, id, newTurn(id, AT, "카페"));
			withdraw(0);
			String next = turnId();

			HttpResponse<String> response = switch (request) {
				case "list" -> send("GET", BASE, token, null);
				case "badCursor" -> send("GET", BASE + "?cursor=broken", token, null);
				case "storedThread" -> send("GET", BASE + "/" + thread, token, null);
				case "missingThread" -> send("GET", BASE + "/" + threadId(), token, null);
				case "badThreadId" -> send("GET", BASE + "/thread-ABC", token, null);
				case "brokenBody" -> put(token, thread, next, "{");
				case "delete" -> send("DELETE", BASE + "/" + thread, token, null);
				case "deleteBadId" -> send("DELETE", BASE + "/thread-ABC", token, null);
				case "deleteAll" -> send("DELETE", BASE, token, null);
				default -> put(token, thread, next, turn(next, "followUp", id, AT, "카페"));
			};

			assertThat(response.statusCode()).isEqualTo(401);
			// 탈퇴 때 지워졌고, 그 뒤 요청은 아무것도 쓰지 않는다(D-13)
			assertThat(count("search_thread_turns")).isZero();
		}

		@Test
		@DisplayName("탈퇴_그회원의thread와turn을모두지우고_다른회원의기록은남긴다")
		void withdraw_deletesOwnRecordsOnly() throws Exception {
			String mine = signIn(0);
			String theirs = signIn(1);
			String thread = threadId();
			String first = turnId();
			String second = turnId();
			put(mine, thread, first, newTurn(first, AT, "카페"));
			put(mine, thread, second, turn(second, "followUp", first, AT + 1, "조건"));
			String other = turnId();
			put(theirs, threadId(), other, newTurn(other, AT, "남의 질문"));

			withdraw(0);

			assertThat(users.findById(USER_PREFIX + 0).orElseThrow().getDeletedAt()).isNotNull();
			assertThat(countOf(0, "search_threads")).isZero();
			assertThat(countOf(0, "search_thread_turns")).isZero();
			assertThat(countOf(1, "search_thread_turns")).isEqualTo(1);
		}

		@Test
		@DisplayName("탈퇴_회원행이실제로지워지면_기록도함께지워진다")
		void deleteUser_hardDelete_cascadesRecords() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();
			String second = turnId();
			put(token, thread, first, newTurn(first, AT, "카페"));
			put(token, thread, second, turn(second, "followUp", first, AT, "조건"));
			// 리프레시 토큰은 회원 FK에 CASCADE가 없어 먼저 지운다
			jdbc.update("delete from auth_refresh_tokens where user_id = ?", USER_PREFIX + 0);

			jdbc.update("delete from auth_users where id = ?", USER_PREFIX + 0);

			assertThat(count("search_threads")).isZero();
			assertThat(count("search_thread_turns")).isZero();
		}
	}

	@Nested
	@DisplayName("형식")
	class Format {

		private static final String TURN = "entry-11111111-2222-3333-4444-555555555555";

		/** {@code $ID}를 경로의 turn id로 바꾼 본문 */
		@ParameterizedTest
		@ValueSource(strings = {
				"{",
				"[]",
				"null",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}},\"extra\":1}",
				"{\"id\":\"entry-11111111-2222-3333-4444-555555555556\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"other\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"baseId\":null,\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1.5,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":-1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":8640000000000001,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":\"1\",\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\" \\n\\t \"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"\\u00a0\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"\\u3000\\ufeff\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":1},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\",\"cursor\":null},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":[],\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{},\"nextCursor\":null}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":{},\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":-1,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":1.5,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":null}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\\u0000\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[{\"a\\u0000\":1}],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[\"\\ud800\"],\"totalCount\":0,\"conditions\":{}}}",
				"{\"id\":\"$ID\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{\"\\udc00x\":1}}}"
		})
		@DisplayName("추가_형식규칙을어기면_400이고저장하지않는다")
		void put_badFormat_invalid(String body) throws Exception {
			String token = signIn(0);

			HttpResponse<String> response = put(token, threadId(), TURN, body.replace("$ID", TURN));

			assertThat(response.statusCode()).isEqualTo(400);
			assertThat(type(response)).isEqualTo(INVALID);
			assertThat(count("search_threads")).isZero();
		}

		@Test
		@DisplayName("추가_질문이201자면_400이다")
		void put_query201Chars_invalid() throws Exception {
			String token = signIn(0);

			HttpResponse<String> response = put(token, threadId(), TURN, newTurn(TURN, AT, "가".repeat(201)));

			assertThat(response.statusCode()).isEqualTo(400);
		}

		@Test
		@DisplayName("추가_앞공백을포함해trim전200자인질문과at0은_받는다")
		void put_query200CharsAtZero_saved() throws Exception {
			String token = signIn(0);

			HttpResponse<String> response = put(token, threadId(), TURN, newTurn(TURN, 0, " " + "가".repeat(199)));

			assertThat(response.statusCode()).isEqualTo(204);
		}

		@Test
		@DisplayName("추가_at이JS_Date상한을지수표기로보내도_받고같은밀리초로돌려준다")
		void put_atAtJsDateMax_savedAndReadBack() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String body = newTurn(TURN, 0, "q").replace("\"at\":0", "\"at\":8.64e15");

			HttpResponse<String> response = put(token, thread, TURN, body);

			assertThat(response.statusCode()).isEqualTo(204);
			assertThat(getThread(token, thread).get("turns").get(0).get("at").longValue())
					.isEqualTo(8_640_000_000_000_000L);
		}

		@Test
		@DisplayName("추가_경로의id형식이틀리면_400이다")
		void put_badPathIds_invalid() throws Exception {
			String token = signIn(0);

			assertThat(put(token, "thread-ABC", TURN, newTurn(TURN, AT, "q")).statusCode()).isEqualTo(400);
			assertThat(put(token, threadId(), "entry-x", newTurn("entry-x", AT, "q")).statusCode()).isEqualTo(400);
			assertThat(put(token, "thread-" + UUID.randomUUID().toString().toUpperCase(), TURN, newTurn(TURN, AT, "q"))
					.statusCode()).isEqualTo(400);
		}

		@Test
		@DisplayName("추가_400과409와동시첫생성때_앱로그에본문이없다")
		void put_rejected_noBodyInLogs(CapturedOutput output) throws Exception {
			String token = signIn(0);
			String secret = "비밀취향마커";
			String thread = threadId();
			String first = turnId();
			put(token, thread, first, newTurn(first, AT, secret));

			put(token, thread, first, newTurn(first, AT + 1, secret));
			put(token, thread, TURN, newTurn(TURN, AT, secret + "\u0000").replace("\u0000", "\\u0000"));
			String next = turnId();
			put(token, thread, next, turn(next, "followUp", turnId(), AT, secret));
			String racing = threadId();
			List<CompletableFuture<HttpResponse<String>>> futures = IntStream.range(0, 4).mapToObj(i -> {
				String id = turnId();
				return client.sendAsync(request("PUT", BASE + "/" + racing + "/turns/" + id, token,
						newTurn(id, AT, secret)), HttpResponse.BodyHandlers.ofString());
			}).toList();
			futures.forEach(CompletableFuture::join);

			assertThat(output.getAll()).doesNotContain(secret);
		}
	}

	@Nested
	@DisplayName("응답 헤더")
	class Headers {

		@Test
		@DisplayName("응답_성공과핸들러가만드는오류모두_Cache-Control_no-store다")
		void anyApi_handlerResponse_noStore() throws Exception {
			String token = signIn(0);
			String thread = threadId();
			String first = turnId();

			List<HttpResponse<String>> responses = List.of(
					put(token, thread, first, newTurn(first, AT, "카페")),
					put(token, thread, first, newTurn(first, AT + 1, "카페")),
					put(token, thread, turnId(), "{"),
					send("GET", BASE, token, null),
					send("GET", BASE + "?cursor=x", token, null),
					send("GET", BASE + "/" + thread, token, null),
					send("GET", BASE + "/" + threadId(), token, null),
					send("GET", BASE, null, null),
					send("DELETE", BASE + "/thread-ABC", token, null),
					send("DELETE", BASE + "/" + thread, token, null),
					send("DELETE", BASE, token, null));

			assertThat(responses).extracting(HttpResponse::statusCode).containsExactly(204, 409, 400, 200, 400, 200,
					404, 401, 400, 204, 204);
			assertThat(responses).allSatisfy(response ->
					assertThat(response.headers().firstValue("Cache-Control")).hasValue("no-store"));
		}
	}

}
