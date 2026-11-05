package kr.co.fitdining.api.place.engine;

import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceCard.ScoreItem;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.user.Preferences;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 검색 API({@code POST /v1/search})를 부른다. 시간 예산, {@code 503 BUSY} 재시도와 그 앞의 쉼, 차단기, 동시성 상한과
 * 자리 기다림, 실패 분류는 place-ai-search spec의 "호출 규칙"과 AC-7·8·13·16·28을 따른다. 실패하면 빈 값을 돌려주고 엔진이
 * 대체한다.
 *
 * <p>요청·응답 본문과 예외 메시지에는 검색 문장과 AI 문구가 들어 있어 로그에 남기지 않는다. 실패 종류(예외 클래스나 상태
 * 코드)만 남긴다(AC-20). 본문은 앱 전역 Jackson 설정(null 생략, 모르는 속성 거부)과 달리 이 클래스의 매퍼로 쓰고 읽는다.
 */
@Slf4j
@Component
@ConditionalOnCatalogMode
public class AiSearchClient {

	static final String PATH = "/v1/search";
	static final Duration BUDGET = Duration.ofSeconds(12);
	/** {@code BUSY} 뒤 다시 부르려면 쉰 뒤에도 남아 있어야 하는 예산. AI 응답 시간의 중앙값 3.4초를 쓴 임시값이다(D-3). */
	static final Duration MIN_RETRY_TIME = Duration.ofMillis(3400);
	/** {@code Retry-After}를 따라 쉬는 최대 시간. AI가 더 길게 달라고 해도 이만큼만 쉰다(D-3). */
	static final Duration MAX_RETRY_AFTER = Duration.ofSeconds(2);
	/** 자리가 꽉 찼을 때 자리가 나기를 기다리는 최대 시간. 임시값이다(D-17). */
	static final Duration SLOT_WAIT = Duration.ofSeconds(2);
	static final int FAILURE_THRESHOLD = 3;
	static final Duration OPEN_DURATION = Duration.ofSeconds(30);
	/** AI를 기다리는 검색 수의 상한. AI 컨테이너 하나가 받는 검색 수({@code MAX_CONCURRENT_REQUESTS} 기본 8)와 같다(D-17). */
	static final int MAX_IN_FLIGHT = 8;

	private static final JsonMapper MAPPER = JsonMapper.builder()
			.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.build();
	private static final Breaker CLOSED = new Breaker(0, null);

	private final String baseUrl;
	private final String key;
	private final String secret;
	private final Timing timing;
	private final Clock clock;
	private final Function<Duration, RestClient> clients;
	private final Sleeper sleeper;
	private final AtomicReference<Breaker> breaker = new AtomicReference<>(CLOSED);
	/** 자리를 기다리는 검색은 먼저 온 순서로 자리를 받는다. */
	private final Semaphore inFlight = new Semaphore(MAX_IN_FLIGHT, true);

	@Autowired
	public AiSearchClient(@Value("${fitdining.ai.base-url:http://localhost:8000}") String baseUrl,
			@Value("${fitdining.ai.modal-key:}") String key, @Value("${fitdining.ai.modal-secret:}") String secret,
			Optional<Clock> clock) {
		this(baseUrl, key, secret, Timing.DEFAULT, clock.orElseGet(Clock::systemUTC));
	}

	AiSearchClient(String baseUrl, String key, String secret, Timing timing, Clock clock) {
		this(baseUrl, key, secret, timing, clock, jdkClients(timing.budget()), Thread::sleep);
	}

	/**
	 * @param clients 시도마다 남은 예산을 제한 시간으로 하는 클라이언트를 만든다
	 * @param sleeper {@code BUSY} 뒤 {@code Retry-After}만큼 쉰다
	 */
	AiSearchClient(String baseUrl, String key, String secret, Timing timing, Clock clock,
			Function<Duration, RestClient> clients, Sleeper sleeper) {
		this.baseUrl = baseUrl == null ? "" : baseUrl.strip();
		this.key = key == null ? "" : key;
		this.secret = secret == null ? "" : secret;
		this.timing = timing;
		this.clock = clock;
		this.clients = clients;
		this.sleeper = sleeper;
	}

	/** 연결부터 본문을 다 읽을 때까지를 시도마다 남은 예산으로 끊는다(JDK 요청 팩토리의 제한 시간은 본문 읽기까지 덮는다). */
	private static Function<Duration, RestClient> jdkClients(Duration budget) {
		HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(budget).build();
		RestClient base = RestClient.create();
		return timeout -> {
			JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
			factory.setReadTimeout(timeout);
			return base.mutate().requestFactory(factory).build();
		};
	}

	/**
	 * AI 검색을 부른다.
	 *
	 * @param request 추천 검색 요청. {@code cursor}는 보내지 않고, {@code preferences}는 비회원일 때만 {@code tasteProfile}로 보낸다.
	 * @param userId 검증된 토큰의 사용자 id. 비회원이면 null이다.
	 * @return 읽을 수 있는 200 응답. 주소가 없거나, 차단 중이거나, 기다려도 자리가 나지 않거나, 실패하면 빈 값이다.
	 */
	public Optional<Response> search(PlaceSearchRequest request, String userId) {
		if (baseUrl.isEmpty()) {
			log.error("AI search skipped: fitdining.ai.base-url is blank");
			return Optional.empty();
		}
		if (open()) {
			return Optional.empty();
		}
		// 예산은 자리를 기다리기 전부터 잰다. 자리 기다림, 시도, 재시도 앞의 쉼을 모두 예산 안에 넣는다
		long deadline = System.nanoTime() + timing.budget().toNanos();
		if (!acquire(deadline)) {
			return Optional.empty();
		}
		try {
			// 자리를 기다리는 동안 차단이 시작됐으면 부르지 않는다
			if (open()) {
				return Optional.empty();
			}
			Response response = call(body(request, userId), deadline);
			recordSuccess();
			return Optional.of(response);
		} catch (Failure failure) {
			if (failure.kind.counted) {
				log.warn("AI search failed: kind={}, reason={}", failure.kind, failure.reason);
				recordFailure();
			} else {
				log.error("AI search failed: kind={}, reason={}", failure.kind, failure.reason);
			}
		} catch (RuntimeException e) {
			log.error("AI search failed: kind={}, reason={}", Kind.INVALID, e.getClass().getSimpleName());
		} finally {
			inFlight.release();
		}
		return Optional.empty();
	}

	private boolean open() {
		Breaker state = breaker.get();
		return state.openUntil() != null && clock.instant().isBefore(state.openUntil());
	}

	/**
	 * 자리를 잡는다. 꽉 찼으면 남은 예산 안에서 {@link Timing#slotWait()}까지 기다리고, 그 사이 다른 검색이 자리를 돌려주면 바로
	 * 잡는다. 그래도 자리가 나지 않으면 대체한다. AI가 멈췄을 때 BE의 요청 스레드가 검색마다 예산만큼 묶이지 않게 하려는
	 * 것이다(D-17).
	 */
	private boolean acquire(long deadline) {
		long wait = Math.max(0, Math.min(timing.slotWait().toNanos(), remaining(deadline)));
		try {
			if (inFlight.tryAcquire(wait, TimeUnit.NANOSECONDS)) {
				return true;
			}
			log.warn("AI search skipped: in-flight limit reached, limit={}, waitedMs={}", MAX_IN_FLIGHT,
					Duration.ofNanos(wait).toMillis());
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			log.error("AI search failed: kind={}, reason={}", Kind.INTERRUPTED, "slot wait");
		}
		return false;
	}

	private static byte[] body(PlaceSearchRequest request, String userId) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("query", request.query());
		if (request.previousConditions() != null && !request.previousConditions().isEmpty()) {
			body.put("previousConditions", request.previousConditions());
		}
		Map<String, Double> bounds = bounds(request.mapBounds());
		if (!bounds.isEmpty()) {
			body.put("mapBounds", bounds);
		}
		if (userId != null) {
			body.put("userId", userId);
		} else if (request.preferences() != null) {
			body.put("tasteProfile", tasteProfile(request.preferences()));
		}
		return MAPPER.writeValueAsBytes(body);
	}

	/** 비회원 답변을 그대로 옮긴다. null인 {@code mood}·{@code code}는 빼고 빈 목록은 그대로 둔다. */
	private static Map<String, Object> tasteProfile(Preferences preferences) {
		Map<String, Object> profile = new LinkedHashMap<>();
		if (preferences.mood() != null) {
			profile.put("mood", preferences.mood());
		}
		profile.put("priorities", preferences.priorities());
		profile.put("purposes", preferences.purposes());
		profile.put("tastes", preferences.tastes().stream().map(chip -> {
			Map<String, Object> taste = new LinkedHashMap<>();
			taste.put("polarity", chip.polarity());
			taste.put("label", chip.label());
			if (chip.code() != null) {
				taste.put("code", chip.code());
			}
			return taste;
		}).toList());
		return profile;
	}

	private static Map<String, Double> bounds(MapBounds mapBounds) {
		Map<String, Double> bounds = new LinkedHashMap<>();
		if (mapBounds != null) {
			putIfPresent(bounds, "swLat", mapBounds.swLat());
			putIfPresent(bounds, "swLng", mapBounds.swLng());
			putIfPresent(bounds, "neLat", mapBounds.neLat());
			putIfPresent(bounds, "neLng", mapBounds.neLng());
		}
		return bounds;
	}

	private static void putIfPresent(Map<String, Double> map, String name, Double value) {
		if (value != null) {
			map.put(name, value);
		}
	}

	/** {@code 503 BUSY}면 {@code Retry-After}만큼 쉬고 남은 예산 안에서 한 번만 다시 부른다. */
	private Response call(byte[] body, long deadline) {
		Attempt attempt = attempt(body, deadline);
		if (attempt.busy()) {
			waitForRetry(attempt.retryAfter(timing.maxRetryAfter()), deadline);
			attempt = attempt(body, deadline);
			if (attempt.busy()) {
				throw new Failure(Kind.BUSY, "503");
			}
		}
		if (attempt.status() == 200) {
			return parse(attempt.body());
		}
		throw new Failure(attempt.status() >= 500 ? Kind.SERVER_ERROR : Kind.STATUS, Integer.toString(attempt.status()));
	}

	/**
	 * 다시 부르기 전에 쉰다. 쉰 뒤에 {@link Timing#minRetry()}가 남지 않을 것이면 쉬지 않고, 쉰 뒤에 다시 재서 모자라도 다시
	 * 부르지 않는다. 성공하기 어려운 재시도로 AI에 부하만 더하지 않으려는 것이다(D-3).
	 */
	private void waitForRetry(Duration wait, long deadline) {
		if (remaining(deadline) < wait.toNanos() + timing.minRetry().toNanos()) {
			throw new Failure(Kind.BUSY, "503");
		}
		if (!wait.isZero()) {
			try {
				sleeper.sleep(wait);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				throw new Failure(Kind.INTERRUPTED, "retry wait");
			}
			if (remaining(deadline) < timing.minRetry().toNanos()) {
				throw new Failure(Kind.BUSY, "503");
			}
		}
	}

	/** 남은 예산을 한 번만 재서 그 값을 제한 시간으로 부른다. 두 번 재면 그 사이에 예산이 끝나 음수 제한 시간이 될 수 있다. */
	private Attempt attempt(byte[] body, long deadline) {
		long left = remaining(deadline);
		if (left <= 0) {
			throw new Failure(Kind.TIMEOUT, "budget");
		}
		try {
			return clients.apply(Duration.ofNanos(left)).post()
					.uri(URI.create(baseUrl + PATH))
					.contentType(MediaType.APPLICATION_JSON)
					.headers(headers -> {
						if (!key.isBlank()) {
							headers.set("Modal-Key", key);
						}
						if (!secret.isBlank()) {
							headers.set("Modal-Secret", secret);
						}
					})
					.body(body)
					.exchange((req, res) -> new Attempt(res.getStatusCode().value(), res.getBody().readAllBytes(),
							res.getHeaders().getFirst(HttpHeaders.RETRY_AFTER)));
		} catch (ResourceAccessException e) {
			Throwable cause = e.getCause() == null ? e : e.getCause();
			boolean timedOut = cause instanceof HttpTimeoutException || cause instanceof SocketTimeoutException
					|| remaining(deadline) <= 0;
			throw new Failure(timedOut ? Kind.TIMEOUT : Kind.CONNECTION, cause.getClass().getSimpleName());
		}
	}

	private static long remaining(long deadline) {
		return deadline - System.nanoTime();
	}

	private static Response parse(byte[] body) {
		Response response;
		try {
			response = MAPPER.readValue(body, Response.class);
		} catch (JacksonException e) {
			throw new Failure(Kind.INVALID, e.getClass().getSimpleName());
		}
		if (!readable(response)) {
			throw new Failure(Kind.INVALID, "MissingOrNullValue");
		}
		return response;
	}

	/** {@code items}가 있고, 카드와 {@code placeId}, 목록의 원소가 null이 아니다(spec "읽을 수 없는 응답"). */
	private static boolean readable(Response response) {
		return response != null && response.items() != null && noNulls(response.fallbacks())
				&& response.items().stream().allMatch(item -> item != null && item.placeId() != null
						&& noNulls(item.labels()) && noNulls(item.scoreItems()) && noNulls(item.reasons())
						&& (item.reasons() == null || item.reasons().stream().allMatch(reason -> noNulls(reason.tags()))));
	}

	private static boolean noNulls(List<?> list) {
		return list == null || list.stream().noneMatch(Objects::isNull);
	}

	private void recordSuccess() {
		if (breaker.getAndSet(CLOSED).failures() >= FAILURE_THRESHOLD) {
			log.info("AI search circuit closed");
		}
	}

	/** 연속 실패가 임계값 이상이면 이 실패가 끝난 때부터 다시 30초 동안 차단한다. */
	private void recordFailure() {
		Instant now = clock.instant();
		Breaker next = breaker.updateAndGet(state -> {
			int failures = state.failures() + 1;
			return new Breaker(failures, failures >= FAILURE_THRESHOLD ? now.plus(OPEN_DURATION) : null);
		});
		if (next.openUntil() != null) {
			log.warn("AI search circuit opened: failures={}", next.failures());
		}
	}

	/**
	 * AI 응답 중 BE가 읽는 속성. 그 밖의 속성은 어느 깊이에서든 무시한다. {@code items} 말고는 AI가 빼면 null이다.
	 *
	 * @param conditions AI가 해석한 검색 조건. 응답 {@code conditions}로 그대로 옮긴다. 빠지면 null이다.
	 * @param nearby 근처 검색인지. 빠지면 null이다.
	 * @param changeSummary 후속 검색에서 바뀐 점. 새 검색이면 빠져 null이다.
	 * @param emptyReason 결과가 없을 때의 원인과 제안. 결과가 있으면 빠져 null이다.
	 * @param items 카드. 응답 순서가 화면 순서다. 읽을 수 있는 응답에서는 null이 아니고 null 원소도 없다.
	 * @param fallbacks AI가 대신 처리한 이유. 빠지면 null이다. null 원소는 없다.
	 * @param interpretedBy 로그에만 쓴다. 어떤 JSON 값이든 받는다. 빠지면 null이다.
	 * @param rankedBy 로그에만 쓴다. 결과가 없으면 빠져 null이다.
	 * @param models 로그에만 쓴다. 빠지면 null이다.
	 */
	public record Response(Map<String, Object> conditions, Boolean nearby, String changeSummary,
			EmptyReason emptyReason, List<Item> items, List<String> fallbacks, JsonNode interpretedBy,
			JsonNode rankedBy, JsonNode models) {
	}

	/**
	 * AI 카드. {@code placeId}로 카탈로그의 장소 정보를 붙인다. 목록에는 null 원소가 없다.
	 *
	 * @param placeId 장소 id. null이 아니다.
	 * @param score 핏 점수. 빠지면 null이다.
	 * @param labels 카드 라벨. 빠지면 null이다.
	 * @param reasons 추천 이유. 빠지면 null이다.
	 * @param scoreItems 점수 항목. 빠지면 null이다.
	 */
	public record Item(Long placeId, Integer score, List<String> labels, List<Reason> reasons,
			List<ScoreItem> scoreItems) {
	}

	/**
	 * 시간 값. 빈은 {@link #DEFAULT}를 쓰고 테스트는 짧은 값을 넣는다.
	 *
	 * @param budget 검색 하나가 AI를 기다리는 전체 시간. 자리 기다림, 시도, 재시도 앞의 쉼을 모두 넣는다
	 * @param minRetry {@code BUSY} 뒤 다시 부르려면 쉰 뒤에도 남아 있어야 하는 예산
	 * @param maxRetryAfter {@code Retry-After}를 따라 쉬는 최대 시간
	 * @param slotWait 자리가 꽉 찼을 때 기다리는 최대 시간
	 */
	record Timing(Duration budget, Duration minRetry, Duration maxRetryAfter, Duration slotWait) {

		static final Timing DEFAULT = new Timing(BUDGET, MIN_RETRY_TIME, MAX_RETRY_AFTER, SLOT_WAIT);
	}

	/** 정해진 시간 동안 쉰다. 테스트는 실제로 쉬지 않고 쉰 시간을 기록한다. */
	@FunctionalInterface
	interface Sleeper {

		void sleep(Duration duration) throws InterruptedException;
	}

	/**
	 * 차단기 상태. 두 값을 함께 바꾼다.
	 *
	 * @param failures 연속 실패 수
	 * @param openUntil 차단이 끝나는 시각. 연속 실패 수가 임계값보다 적으면 null이다.
	 */
	private record Breaker(int failures, Instant openUntil) {
	}

	/**
	 * 한 번 부른 결과.
	 *
	 * @param status HTTP 상태 코드
	 * @param body 응답 본문. 로그에 남기지 않는다.
	 * @param retryAfterHeader {@code Retry-After} 헤더 값. 없으면 null이다.
	 */
	private record Attempt(int status, byte[] body, String retryAfterHeader) {

		/** {@code Retry-After}의 초. 없거나 초 숫자가 아니면(날짜 형식 포함) 0이고, {@code max}보다 길면 {@code max}다. */
		Duration retryAfter(Duration max) {
			String value = retryAfterHeader == null ? "" : retryAfterHeader.strip();
			if (!value.matches("\\d{1,9}")) {
				return Duration.ZERO;
			}
			Duration wait = Duration.ofSeconds(Long.parseLong(value));
			return wait.compareTo(max) > 0 ? max : wait;
		}

		/** 상태 503이고 ProblemDetail {@code code}가 {@code BUSY} */
		boolean busy() {
			if (status != 503) {
				return false;
			}
			try {
				JsonNode code = MAPPER.readTree(body).get("code");
				return code != null && code.isString() && "BUSY".equals(code.asString());
			} catch (JacksonException | NullPointerException e) {
				return false;
			}
		}
	}

	/** 실패 종류. 차단기는 {@code counted}인 종류(연결 실패, 시간 초과, 5xx, 재시도 뒤 BUSY)만 센다. */
	enum Kind {
		/** ② 연결 실패. 시간 초과가 아닌 I/O 오류(이름 풀이, 연결 거부·끊김, 본문을 읽다 끊김) */
		CONNECTION(true),
		/** ③ 자리 기다림과 재시도까지 합친 예산 안에 응답이 없음 */
		TIMEOUT(true),
		/** ④ BUSY가 아닌 5xx */
		SERVER_ERROR(true),
		/** ⑤ 재시도 뒤에도 503 BUSY이거나, 쉰 뒤 남을 예산이 모자라 재시도하지 못함 */
		BUSY(true),
		/** ⑥ 200도 5xx도 아닌 상태(4xx, 3xx, 200 외 2xx) */
		STATUS(false),
		/** ⑦ 200이지만 읽을 수 없는 응답, 또는 I/O 오류가 아닌 그 밖의 예외(형식이 잘못된 주소 포함) */
		INVALID(false),
		/** 자리나 재시도를 기다리는 동안 스레드가 중단됨(서버 종료 등). AI 실패가 아니다 */
		INTERRUPTED(false);

		final boolean counted;

		Kind(boolean counted) {
			this.counted = counted;
		}
	}

	private static final class Failure extends RuntimeException {

		final Kind kind;
		final String reason;

		Failure(Kind kind, String reason) {
			super(null, null, false, false);
			this.kind = kind;
			this.reason = reason;
		}
	}

}
