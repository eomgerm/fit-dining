package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import java.util.concurrent.atomic.AtomicInteger;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * 시간 예산(AC-7 ③, AC-8)과 동시성 상한(AC-28). MockRestServiceServer는 요청 팩토리를 바꿔 실제 제한 시간이 돌지 않으므로 JDK 내장 HTTP
 * 서버로 늦게 응답한다. 예산은 짧게 준다.
 */
@ExtendWith(OutputCaptureExtension.class)
class AiSearchClientBudgetTest {

	static final Duration BUDGET = Duration.ofMillis(500);
	/** time-out 500ms에 맞춰 줄인 값. 최소 처리 시간 100ms, Retry-After 상한 300ms, permit 대기 200ms */
	static final AiSearchClient.Timing TIMING = timing(BUDGET);
	static final String SECRET = "비밀표식9c41";
	static final String OK = "{\"items\":[],\"conditions\":{\"text\":\"" + SECRET + "\"}}";
	static final String BUSY = "{\"status\":503,\"code\":\"BUSY\"}";

	HttpServer http;
	final AtomicInteger calls = new AtomicInteger();
	volatile Handler handler;

	interface Handler {
		void handle(HttpExchange exchange, int call) throws IOException, InterruptedException;
	}

	@BeforeEach
	void start() throws IOException {
		http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		http.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
		http.createContext("/v1/search", exchange -> {
			try {
				handler.handle(exchange, calls.incrementAndGet());
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (IOException ignored) {
				// 클라이언트가 먼저 끊었다
			} finally {
				exchange.close();
			}
		});
		http.start();
	}

	@AfterEach
	void stop() {
		http.stop(0);
	}

	static AiSearchClient.Timing timing(Duration budget) {
		return new AiSearchClient.Timing(budget, Duration.ofMillis(100), Duration.ofMillis(300),
				Duration.ofMillis(200));
	}

	String url() {
		return "http://127.0.0.1:" + http.getAddress().getPort();
	}

	AiSearchClient client() {
		return new AiSearchClient(url(), "", "", TIMING, Clock.systemUTC());
	}

	AiSearchClient client(AiSearchClient.Timing timing) {
		return new AiSearchClient(url(), "", "", timing, Clock.systemUTC());
	}

	static void respondBusy(HttpExchange exchange, String retryAfter) throws IOException {
		exchange.getResponseHeaders().set("Retry-After", retryAfter);
		respond(exchange, 503, BUSY);
	}

	/** 상한만큼 검색을 AI 응답 대기 상태로 만든다. 서버는 {@code release}가 열릴 때까지 응답하지 않는다. */
	List<Future<Boolean>> fill(AiSearchClient client, ExecutorService pool) throws InterruptedException {
		return fill(client, pool, SearchPurpose.SEARCH);
	}

	/** 상한만큼의 검색을 주어진 목적으로 AI 응답 대기 상태로 만든다. */
	List<Future<Boolean>> fill(AiSearchClient client, ExecutorService pool, SearchPurpose purpose)
			throws InterruptedException {
		List<Future<Boolean>> waiting = IntStream.range(0, AiSearchClient.MAX_IN_FLIGHT)
				.mapToObj(i -> pool.submit(() -> client.search(purpose, request(), null).isPresent()))
				.toList();
		long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
		while (calls.get() < AiSearchClient.MAX_IN_FLIGHT && System.nanoTime() < deadline) {
			Thread.sleep(10);
		}
		assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT);
		return waiting;
	}

	static void respond(HttpExchange exchange, int status, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		exchange.getResponseHeaders().set("Content-Type", "application/json");
		exchange.sendResponseHeaders(status, bytes.length);
		exchange.getResponseBody().write(bytes);
	}

	/** 결과와 걸린 시간 */
	long timed(Runnable search) {
		long start = System.nanoTime();
		search.run();
		return Duration.ofNanos(System.nanoTime() - start).toMillis();
	}

	/**
	 * 제한 시간이 없는 JDK HTTP 클라이언트. {@code RestClient.create()}는 classpath의 Apache HttpClient 5를 고르는데, 그
	 * 클라이언트는 503 POST를 스스로 1초 뒤 다시 보내 서버 호출 수와 걸린 시간이 달라진다.
	 */
	static RestClient jdkClient() {
		return RestClient.builder().requestFactory(new JdkClientHttpRequestFactory()).build();
	}

	static PlaceSearchRequest request() {
		return new PlaceSearchRequest("카페", null, null, null, null);
	}

	@Test
	@DisplayName("예산_빈으로만든클라이언트는_재시도까지합쳐12초다")
	void budget_default_isTwelveSeconds() {
		// 실제로 12초를 기다리지 않고, 빈 생성자가 쓰는 값만 본다. 예산 동작은 아래 시험이 짧은 값으로 본다.
		assertThat(AiSearchClient.BUDGET).isEqualTo(Duration.ofSeconds(12));
	}

	@Test
	@DisplayName("예산_제때응답하면_읽는다")
	void budget_timelyResponse_succeeds() {
		handler = (exchange, call) -> respond(exchange, 200, OK);

		assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isPresent();
	}

	@Test
	@DisplayName("예산_헤더가늦으면_예산안에시간초과로대체한다")
	void budget_lateHeaders_timesOut(CapturedOutput output) {
		handler = (exchange, call) -> {
			Thread.sleep(2000);
			respond(exchange, 200, OK);
		};

		long elapsed = timed(() -> assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isEmpty());

		assertThat(elapsed).isLessThan(1500);
		assertThat(output.getAll()).contains("WARN").contains("kind=TIMEOUT").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("예산_헤더뒤본문이늦으면_예산안에시간초과로대체한다")
	void budget_lateBodyAfterHeaders_timesOut(CapturedOutput output) {
		handler = (exchange, call) -> {
			byte[] bytes = OK.getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, bytes.length);
			OutputStream body = exchange.getResponseBody();
			body.write(bytes, 0, 5);
			body.flush();
			Thread.sleep(2000);
			body.write(bytes, 5, bytes.length - 5);
		};

		long elapsed = timed(() -> assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isEmpty());

		assertThat(elapsed).isLessThan(1500);
		assertThat(output.getAll()).contains("WARN").contains("kind=TIMEOUT").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("예산_200헤더뒤본문을읽다끊기면_연결실패로대체한다")
	void budget_bodyCutAfterHeaders_connectionFailure(CapturedOutput output) {
		// Content-Length보다 적게 보내고 바로 닫는다. 기다리지 않으므로 시간 초과가 아니다.
		handler = (exchange, call) -> {
			byte[] bytes = OK.getBytes(StandardCharsets.UTF_8);
			exchange.getResponseHeaders().set("Content-Type", "application/json");
			exchange.sendResponseHeaders(200, bytes.length);
			exchange.getResponseBody().write(bytes, 0, 5);
			exchange.getResponseBody().flush();
			throw new IOException("cut");
		};
		AiSearchClient client = client(timing(Duration.ofSeconds(5)));

		long elapsed = timed(() -> assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty());

		assertThat(elapsed).isLessThan(4000);
		assertThat(output.getAll()).contains("WARN").contains("kind=CONNECTION").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("예산_BUSY뒤재시도가늦으면_재시도까지합쳐예산안에서끊는다")
	void budget_slowRetryAfterBusy_staysWithinBudget(CapturedOutput output) {
		handler = (exchange, call) -> {
			if (call == 1) {
				Thread.sleep(300);
				respond(exchange, 503, BUSY);
				return;
			}
			Thread.sleep(2000);
			respond(exchange, 200, OK);
		};

		long elapsed = timed(() -> assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isEmpty());

		assertThat(calls).hasValue(2);
		assertThat(elapsed).isLessThan(1500);
		assertThat(output.getAll()).contains("kind=TIMEOUT");
	}

	@Test
	@DisplayName("예산_BUSY가예산을다쓴뒤오면_재시도하지않고BUSY실패다")
	void budget_busyAfterBudget_noRetry(CapturedOutput output) {
		// 제한 시간을 무시하는 클라이언트로, 예산이 지난 뒤 도착한 BUSY를 만든다.
		handler = (exchange, call) -> {
			Thread.sleep(200);
			respond(exchange, 503, BUSY);
		};
		RestClient unbounded = jdkClient();
		AtomicInteger attempts = new AtomicInteger();
		AiSearchClient client = new AiSearchClient(url(), "", "", timing(Duration.ofMillis(100)), Clock.systemUTC(),
				timeout -> {
					attempts.incrementAndGet();
					return unbounded;
				}, Thread::sleep);

		assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty();
		assertThat(attempts).hasValue(1);
		assertThat(calls).hasValue(1);
		assertThat(output.getAll()).contains("kind=BUSY");
	}

	@Test
	@DisplayName("예산_BUSY뒤재시도가성공하면_읽는다")
	void budget_busyThenSuccess_succeeds() {
		handler = (exchange, call) -> respond(exchange, call == 1 ? 503 : 200, call == 1 ? BUSY : OK);

		assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isPresent();
		assertThat(calls).hasValue(2);
	}

	@Test
	@DisplayName("BUSY_RetryAfter가있으면_그만큼기다린뒤재요청한다")
	void busy_retryAfter_waitsBeforeRetry() {
		long[] at = new long[3];
		handler = (exchange, call) -> {
			at[call] = System.nanoTime();
			if (call == 1) {
				respondBusy(exchange, "1");
				return;
			}
			respond(exchange, 200, OK);
		};

		assertThat(client().search(SearchPurpose.SEARCH, request(), null)).isPresent();

		// Retry-After 1초를 TIMING의 상한 300ms로 줄여 쉰다
		assertThat(calls).hasValue(2);
		assertThat(Duration.ofNanos(at[2] - at[1]).toMillis()).isGreaterThanOrEqualTo(250);
	}

	@Test
	@DisplayName("BUSY_쉰뒤남은예산이최소처리시간보다적으면_다시부르지않는다")
	void busy_budgetGoneAfterWait_noRetry(CapturedOutput output) {
		handler = (exchange, call) -> respondBusy(exchange, "1");
		// 첫 BUSY는 바로 와서 쉬기 전 검사(남은 예산 >= 쉴 300ms + 최소 처리 100ms)는 지난다. 300ms를 쉬라고 하면 600ms를 멈춰
		// time-out 500ms를 넘기므로, 쉰 뒤 다시 잰 검사에서 재요청을 그만둔다(AC-8).
		AtomicInteger attempts = new AtomicInteger();
		AiSearchClient client = new AiSearchClient(url(), "", "", TIMING, Clock.systemUTC(), timeout -> {
			attempts.incrementAndGet();
			return jdkClient();
		}, duration -> Thread.sleep(duration.plusMillis(300)));

		assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty();
		assertThat(attempts).hasValue(1);
		assertThat(calls).hasValue(1);
		assertThat(output.getAll()).contains("kind=BUSY").contains("retry skipped after wait");
	}

	@Test
	@DisplayName("상한_기다려도permit을못받으면_호출하지않고fallback하고차단기는그대로다")
	void inFlight_limitReached_fallsBackWithoutCalling(CapturedOutput output) throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		handler = (exchange, call) -> {
			release.await();
			respond(exchange, 200, OK);
		};
		AiSearchClient client = client(timing(Duration.ofSeconds(10)));
		ExecutorService pool = Executors.newFixedThreadPool(AiSearchClient.MAX_IN_FLIGHT);
		try {
			List<Future<Boolean>> waiting = fill(client, pool);

			for (int i = 0; i < AiSearchClient.FAILURE_THRESHOLD; i++) {
				long elapsed = timed(() -> assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty());
				// permit 대기 200ms만 기다린다
				assertThat(elapsed).isBetween(150L, 1000L);
			}
			assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT);

			release.countDown();
			for (Future<Boolean> search : waiting) {
				assertThat(search.get()).isTrue();
			}
		} finally {
			release.countDown();
			pool.shutdownNow();
		}
		assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isPresent();
		assertThat(output.getAll()).contains("WARN").contains("in-flight limit reached")
				.doesNotContain("circuit opened").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("상한_NEARBY가permit을다쓰면_SEARCH와REGION도호출하지않고fallback한다")
	void inFlight_limitHeldByNearby_otherPurposesFallBack() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		handler = (exchange, call) -> {
			release.await();
			respond(exchange, 200, OK);
		};
		AiSearchClient client = client(timing(Duration.ofSeconds(10)));
		ExecutorService pool = Executors.newFixedThreadPool(AiSearchClient.MAX_IN_FLIGHT);
		try {
			List<Future<Boolean>> waiting = fill(client, pool, SearchPurpose.NEARBY);

			assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty();
			assertThat(client.search(SearchPurpose.REGION, request(), null)).isEmpty();
			assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT);

			release.countDown();
			for (Future<Boolean> search : waiting) {
				assertThat(search.get()).isTrue();
			}
		} finally {
			release.countDown();
			pool.shutdownNow();
		}
	}

	@Test
	@DisplayName("상한_기다리는동안permit이반납되면_AI를호출한다")
	void inFlight_permitReleasedWhileWaiting_callsAi() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		handler = (exchange, call) -> {
			if (call <= AiSearchClient.MAX_IN_FLIGHT) {
				release.await();
			}
			respond(exchange, 200, OK);
		};
		AiSearchClient client = client(new AiSearchClient.Timing(Duration.ofSeconds(10), Duration.ofMillis(100),
				Duration.ofMillis(300), Duration.ofSeconds(5)));
		ExecutorService pool = Executors.newFixedThreadPool(AiSearchClient.MAX_IN_FLIGHT + 1);
		try {
			List<Future<Boolean>> waiting = fill(client, pool);
			long start = System.nanoTime();
			Future<Boolean> ninth = pool.submit(() -> client.search(SearchPurpose.SEARCH, request(), null).isPresent());
			Thread.sleep(200);
			assertThat(ninth).isNotDone();

			release.countDown();

			assertThat(ninth.get()).isTrue();
			assertThat(Duration.ofNanos(System.nanoTime() - start).toMillis()).isLessThan(3000);
			assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT + 1);
			for (Future<Boolean> search : waiting) {
				assertThat(search.get()).isTrue();
			}
		} finally {
			release.countDown();
			pool.shutdownNow();
		}
	}

	@Test
	@DisplayName("상한_permit대기도_timeout안이다")
	void inFlight_permitWait_staysWithinBudget() throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		handler = (exchange, call) -> {
			release.await();
			respond(exchange, 200, OK);
		};
		// permit 대기 상한(5초)이 time-out(1초)보다 길어도 time-out 안에서 끝난다
		AiSearchClient client = client(new AiSearchClient.Timing(Duration.ofSeconds(1), Duration.ofMillis(100),
				Duration.ofMillis(300), Duration.ofSeconds(5)));
		ExecutorService pool = Executors.newFixedThreadPool(AiSearchClient.MAX_IN_FLIGHT);
		try {
			fill(client, pool);

			long elapsed = timed(() -> assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty());

			assertThat(elapsed).isLessThan(2000);
		} finally {
			release.countDown();
			pool.shutdownNow();
		}
	}

	@Test
	@DisplayName("상한_실패한검색도_permit을반납한다")
	void inFlight_failures_releaseSlots() {
		// 차단기가 세지 않는 실패(4xx, 읽을 수 없는 응답)를 상한보다 많이 이어 보내도 모두 AI에 닿는다
		handler = (exchange, call) -> respond(exchange, call % 2 == 0 ? 400 : 200, call % 2 == 0 ? BUSY : "{");
		AiSearchClient client = client();

		for (int i = 0; i < AiSearchClient.MAX_IN_FLIGHT * 2; i++) {
			assertThat(client.search(SearchPurpose.SEARCH, request(), null)).isEmpty();
		}
		assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT * 2);
	}

}
