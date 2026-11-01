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
 * AI 검색 API({@code POST /v1/search})를 부른다. 시간 예산, {@code 503 BUSY} 재시도, 차단기, 실패 분류는 place-ai-search
 * spec의 "호출 규칙"과 AC-7·8·13·16을 따른다. 실패하면 빈 값을 돌려주고 엔진이 대체한다.
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
	static final int FAILURE_THRESHOLD = 3;
	static final Duration OPEN_DURATION = Duration.ofSeconds(30);

	private static final JsonMapper MAPPER = JsonMapper.builder()
			.disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.build();
	private static final Breaker CLOSED = new Breaker(0, null);

	private final String baseUrl;
	private final String key;
	private final String secret;
	private final Duration budget;
	private final Clock clock;
	private final Function<Duration, RestClient> clients;
	private final AtomicReference<Breaker> breaker = new AtomicReference<>(CLOSED);

	@Autowired
	public AiSearchClient(@Value("${fitdining.ai.base-url:http://localhost:8000}") String baseUrl,
			@Value("${fitdining.ai.modal-key:}") String key, @Value("${fitdining.ai.modal-secret:}") String secret,
			Optional<Clock> clock) {
		this(baseUrl, key, secret, BUDGET, clock.orElseGet(Clock::systemUTC));
	}

	AiSearchClient(String baseUrl, String key, String secret, Duration budget, Clock clock) {
		this(baseUrl, key, secret, budget, clock, jdkClients(budget));
	}

	/** @param clients 시도마다 남은 예산을 제한 시간으로 하는 클라이언트를 만든다 */
	AiSearchClient(String baseUrl, String key, String secret, Duration budget, Clock clock,
			Function<Duration, RestClient> clients) {
		this.baseUrl = baseUrl == null ? "" : baseUrl.strip();
		this.key = key == null ? "" : key;
		this.secret = secret == null ? "" : secret;
		this.budget = budget;
		this.clock = clock;
		this.clients = clients;
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
	 * @return 읽을 수 있는 200 응답. 주소가 없거나, 차단 중이거나, 실패하면 빈 값이다.
	 */
	public Optional<Response> search(PlaceSearchRequest request, String userId) {
		if (baseUrl.isEmpty()) {
			log.error("AI search skipped: fitdining.ai.base-url is blank");
			return Optional.empty();
		}
		Breaker state = breaker.get();
		if (state.openUntil() != null && clock.instant().isBefore(state.openUntil())) {
			return Optional.empty();
		}
		try {
			Response response = call(body(request, userId));
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
		}
		return Optional.empty();
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

	/** {@code 503 BUSY}면 남은 예산 안에서 한 번만 다시 부른다(기다리지 않는다). */
	private Response call(byte[] body) {
		long deadline = System.nanoTime() + budget.toNanos();
		Attempt attempt = attempt(body, budget, deadline);
		if (attempt.busy()) {
			// 남은 예산을 한 번만 재서 그 값으로 다시 부른다. 두 번 재면 그 사이에 예산이 끝나 음수 제한 시간이 될 수 있다.
			long left = remaining(deadline);
			if (left <= 0) {
				throw new Failure(Kind.BUSY, "503");
			}
			attempt = attempt(body, Duration.ofNanos(left), deadline);
			if (attempt.busy()) {
				throw new Failure(Kind.BUSY, "503");
			}
		}
		if (attempt.status() == 200) {
			return parse(attempt.body());
		}
		throw new Failure(attempt.status() >= 500 ? Kind.SERVER_ERROR : Kind.STATUS, Integer.toString(attempt.status()));
	}

	private Attempt attempt(byte[] body, Duration timeout, long deadline) {
		try {
			return clients.apply(timeout).post()
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
					.exchange((req, res) -> new Attempt(res.getStatusCode().value(), res.getBody().readAllBytes()));
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
	 */
	private record Attempt(int status, byte[] body) {

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
		/** ③ 재시도까지 합친 예산 안에 응답이 없음 */
		TIMEOUT(true),
		/** ④ BUSY가 아닌 5xx */
		SERVER_ERROR(true),
		/** ⑤ 재시도 뒤에도 503 BUSY이거나, 남은 예산이 없어 재시도하지 못함 */
		BUSY(true),
		/** ⑥ 200도 5xx도 아닌 상태(4xx, 3xx, 200 외 2xx) */
		STATUS(false),
		/** ⑦ 200이지만 읽을 수 없는 응답, 또는 I/O 오류가 아닌 그 밖의 예외(형식이 잘못된 주소 포함) */
		INVALID(false);

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
