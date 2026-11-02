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
import org.springframework.web.client.RestClient;

/**
 * 시간 예산(AC-7 ③, AC-8)과 동시성 상한(AC-28). MockRestServiceServer는 요청 팩토리를 바꿔 실제 제한 시간이 돌지 않으므로 JDK 내장 HTTP
 * 서버로 늦게 응답한다. 예산은 짧게 준다.
 */
@ExtendWith(OutputCaptureExtension.class)
class AiSearchClientBudgetTest {

	static final Duration BUDGET = Duration.ofMillis(500);
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

	AiSearchClient client() {
		return new AiSearchClient("http://127.0.0.1:" + http.getAddress().getPort(), "", "", BUDGET,
				Clock.systemUTC());
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

		assertThat(client().search(request(), null)).isPresent();
	}

	@Test
	@DisplayName("예산_헤더가늦으면_예산안에시간초과로대체한다")
	void budget_lateHeaders_timesOut(CapturedOutput output) {
		handler = (exchange, call) -> {
			Thread.sleep(2000);
			respond(exchange, 200, OK);
		};

		long elapsed = timed(() -> assertThat(client().search(request(), null)).isEmpty());

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

		long elapsed = timed(() -> assertThat(client().search(request(), null)).isEmpty());

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
		AiSearchClient client = new AiSearchClient("http://127.0.0.1:" + http.getAddress().getPort(), "", "",
				Duration.ofSeconds(5), Clock.systemUTC());

		long elapsed = timed(() -> assertThat(client.search(request(), null)).isEmpty());

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

		long elapsed = timed(() -> assertThat(client().search(request(), null)).isEmpty());

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
		RestClient unbounded = RestClient.create();
		AtomicInteger attempts = new AtomicInteger();
		AiSearchClient client = new AiSearchClient("http://127.0.0.1:" + http.getAddress().getPort(), "", "",
				Duration.ofMillis(100), Clock.systemUTC(), timeout -> {
					attempts.incrementAndGet();
					return unbounded;
				});

		assertThat(client.search(request(), null)).isEmpty();
		assertThat(attempts).hasValue(1);
		assertThat(output.getAll()).contains("kind=BUSY");
	}

	@Test
	@DisplayName("예산_BUSY뒤재시도가성공하면_읽는다")
	void budget_busyThenSuccess_succeeds() {
		handler = (exchange, call) -> respond(exchange, call == 1 ? 503 : 200, call == 1 ? BUSY : OK);

		assertThat(client().search(request(), null)).isPresent();
		assertThat(calls).hasValue(2);
	}

	@Test
	@DisplayName("상한_AI를기다리는검색이상한만큼있으면_부르지않고바로대체하고차단기는그대로다")
	void inFlight_limitReached_fallsBackWithoutCalling(CapturedOutput output) throws Exception {
		CountDownLatch release = new CountDownLatch(1);
		handler = (exchange, call) -> {
			release.await();
			respond(exchange, 200, OK);
		};
		AiSearchClient client = new AiSearchClient("http://127.0.0.1:" + http.getAddress().getPort(), "", "",
				Duration.ofSeconds(10), Clock.systemUTC());
		ExecutorService pool = Executors.newFixedThreadPool(AiSearchClient.MAX_IN_FLIGHT);
		try {
			List<Future<Boolean>> waiting = IntStream.range(0, AiSearchClient.MAX_IN_FLIGHT)
					.mapToObj(i -> pool.submit(() -> client.search(request(), null).isPresent()))
					.toList();
			long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
			while (calls.get() < AiSearchClient.MAX_IN_FLIGHT && System.nanoTime() < deadline) {
				Thread.sleep(10);
			}
			assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT);

			for (int i = 0; i < AiSearchClient.FAILURE_THRESHOLD; i++) {
				long elapsed = timed(() -> assertThat(client.search(request(), null)).isEmpty());
				assertThat(elapsed).isLessThan(500);
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
		assertThat(client.search(request(), null)).isPresent();
		assertThat(output.getAll()).contains("WARN").contains("in-flight limit reached")
				.doesNotContain("circuit opened").doesNotContain(SECRET);
	}

	@Test
	@DisplayName("상한_실패한검색도_자리를돌려준다")
	void inFlight_failures_releaseSlots() {
		// 차단기가 세지 않는 실패(4xx, 읽을 수 없는 응답)를 상한보다 많이 이어 보내도 모두 AI에 닿는다
		handler = (exchange, call) -> respond(exchange, call % 2 == 0 ? 400 : 200, call % 2 == 0 ? BUSY : "{");
		AiSearchClient client = client();

		for (int i = 0; i < AiSearchClient.MAX_IN_FLIGHT * 2; i++) {
			assertThat(client.search(request(), null)).isEmpty();
		}
		assertThat(calls).hasValue(AiSearchClient.MAX_IN_FLIGHT * 2);
	}

}
