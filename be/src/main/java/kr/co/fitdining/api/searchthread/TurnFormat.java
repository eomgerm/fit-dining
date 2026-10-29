package kr.co.fitdining.api.searchthread;

import java.math.BigDecimal;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * turn 본문의 형식 규칙(search-thread spec "형식 규칙", D-4). 서버가 받은 turn은 FE {@code parseThreads}가 받아들이는
 * 모양이고, {@code request}와 {@code response} 안쪽은 해석하지 않고 원문 JSON 트리 그대로 둔다.
 *
 * <p>숫자는 읽을 때부터 10진 값(BigDecimal, BigInteger)으로 다뤄 double을 거치지 않는다. 전역 Jackson 설정
 * ({@code non_null}, {@code fail-on-unknown-properties})이 스냅샷에 걸리지 않게 이 클래스만의 매퍼를 쓴다.
 */
final class TurnFormat {

	private static final String UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
	private static final Pattern THREAD_ID = Pattern.compile("thread-" + UUID);
	private static final Pattern TURN_ID = Pattern.compile("entry-" + UUID);
	private static final Set<String> FIELDS = Set.of("id", "kind", "baseId", "at", "request", "response");
	private static final Set<String> KINDS = Set.of("new", "followUp", "region");
	/** JS {@code Date}가 나타낼 수 있는 가장 늦은 시각(밀리초) */
	private static final BigDecimal MAX_AT = new BigDecimal("8.64e15");
	private static final int QUERY_MAX = 200;
	/** PostgreSQL numeric이 받는 자릿수. 넘으면 jsonb로 바꾸지 못한다 */
	private static final int NUMERIC_INTEGER_DIGITS = 131_072;
	private static final int NUMERIC_FRACTION_DIGITS = 16_383;

	static final JsonMapper MAPPER = JsonMapper.builder()
			.enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS, DeserializationFeature.USE_BIG_INTEGER_FOR_INTS,
					DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
			.build();

	private TurnFormat() {
	}

	static boolean isThreadId(String value) {
		return THREAD_ID.matcher(value).matches();
	}

	static void requireThreadId(String value) {
		if (!isThreadId(value)) {
			throw new InvalidSearchThreadException("thread id");
		}
	}

	/**
	 * 본문을 읽어 형식 규칙을 확인한다.
	 *
	 * @param turnId 경로의 turn id
	 * @param body 요청 본문(UTF-8 JSON)
	 * @return 검사를 통과한 turn
	 * @throws InvalidSearchThreadException 본문을 읽을 수 없거나 형식 규칙을 어길 때. 메시지에 본문 내용은 넣지 않는다
	 */
	static Turn parse(String turnId, byte[] body) {
		if (!TURN_ID.matcher(turnId).matches()) {
			throw new InvalidSearchThreadException("turn id");
		}
		JsonNode root;
		try {
			root = MAPPER.readTree(body == null ? new byte[0] : body);
		} catch (JacksonException e) {
			throw new InvalidSearchThreadException("body");
		}
		if (root == null || !root.isObject()) {
			throw new InvalidSearchThreadException("body");
		}
		requireSafeStrings(root);
		for (String name : root.propertyNames()) {
			if (!FIELDS.contains(name)) {
				throw new InvalidSearchThreadException("field");
			}
		}
		JsonNode id = root.get("id");
		if (id == null || !id.isString() || !id.asString().equals(turnId)) {
			throw new InvalidSearchThreadException("id");
		}
		JsonNode kind = root.get("kind");
		if (kind == null || !kind.isString() || !KINDS.contains(kind.asString())) {
			throw new InvalidSearchThreadException("kind");
		}
		JsonNode baseId = root.get("baseId");
		if (baseId != null && !(baseId.isString() && TURN_ID.matcher(baseId.asString()).matches())) {
			throw new InvalidSearchThreadException("baseId");
		}
		long at = at(root.get("at"));
		JsonNode request = root.get("request");
		if (request == null || !request.isObject() || request.has("cursor")) {
			throw new InvalidSearchThreadException("request");
		}
		JsonNode query = request.get("query");
		if (query == null || !query.isString() || query.asString().length() > QUERY_MAX
				|| isJsBlank(query.asString())) {
			throw new InvalidSearchThreadException("query");
		}
		JsonNode response = root.get("response");
		if (response == null || !response.isObject() || response.has("nextCursor")
				|| !isArray(response.get("items")) || !isObject(response.get("conditions"))
				|| !isNonNegativeInteger(response.get("totalCount"))) {
			throw new InvalidSearchThreadException("response");
		}
		return new Turn(turnId, kind.asString(), baseId == null ? null : baseId.asString(), at,
				query.asString(), MAPPER.writeValueAsString(request), MAPPER.writeValueAsString(response));
	}

	private static long at(JsonNode at) {
		if (!isNonNegativeInteger(at) || at.decimalValue().compareTo(MAX_AT) > 0) {
			throw new InvalidSearchThreadException("at");
		}
		return at.decimalValue().longValueExact();
	}

	private static boolean isArray(JsonNode node) {
		return node != null && node.isArray();
	}

	private static boolean isObject(JsonNode node) {
		return node != null && node.isObject();
	}

	/** 값이 정수인지로 본다. {@code 1e3}이나 {@code 2.0}도 정수다 */
	private static boolean isNonNegativeInteger(JsonNode node) {
		if (node == null || !node.isNumber()) {
			return false;
		}
		BigDecimal value = node.decimalValue();
		return value.signum() >= 0 && value.stripTrailingZeros().scale() <= 0;
	}

	/**
	 * 키와 값의 어느 문자열에도 {@code \u0000}과 짝이 없는 서로게이트가 없는지, 숫자가 PostgreSQL numeric 범위인지
	 * 확인한다. 둘 다 {@code jsonb}가 거부한다. 깊은 본문에서도 스택이 넘치지 않게 반복으로 돈다.
	 */
	private static void requireSafeStrings(JsonNode root) {
		Deque<JsonNode> pending = new ArrayDeque<>();
		pending.push(root);
		while (!pending.isEmpty()) {
			JsonNode node = pending.pop();
			if (node.isObject()) {
				for (Map.Entry<String, JsonNode> property : node.properties()) {
					requireSafe(property.getKey());
					pending.push(property.getValue());
				}
			} else if (node.isArray()) {
				node.values().forEach(pending::push);
			} else if (node.isString()) {
				requireSafe(node.asString());
			} else if (node.isNumber()) {
				BigDecimal value = node.decimalValue();
				if (value.precision() - value.scale() > NUMERIC_INTEGER_DIGITS
						|| value.scale() > NUMERIC_FRACTION_DIGITS) {
					throw new InvalidSearchThreadException("number");
				}
			}
		}
	}

	private static void requireSafe(String value) {
		for (int i = 0; i < value.length(); i++) {
			char c = value.charAt(i);
			if (c == '\u0000') {
				throw new InvalidSearchThreadException("string");
			}
			if (Character.isHighSurrogate(c)) {
				if (i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) {
					i++;
					continue;
				}
				throw new InvalidSearchThreadException("string");
			}
			if (Character.isLowSurrogate(c)) {
				throw new InvalidSearchThreadException("string");
			}
		}
	}

	/** JS {@code String.prototype.trim()}의 결과가 빈 문자열인지. 공백 목록은 WhiteSpace와 LineTerminator다 */
	static boolean isJsBlank(String value) {
		for (int i = 0; i < value.length(); i++) {
			if (!isJsWhitespace(value.charAt(i))) {
				return false;
			}
		}
		return true;
	}

	private static boolean isJsWhitespace(char c) {
		return switch (c) {
			case '\t', '\u000B', '\f', '﻿', '\n', '\r', ' ', ' ' -> true;
			default -> Character.getType(c) == Character.SPACE_SEPARATOR;
		};
	}

	/**
	 * 형식 검사를 통과한 turn.
	 *
	 * @param id turn id
	 * @param kind new, followUp, region
	 * @param baseId 기준 turn id. new면 없다
	 * @param at 기기 시각(밀리초)
	 * @param query 요청의 질문. thread의 첫 turn이면 제목이 된다
	 * @param request 요청 원문 JSON
	 * @param response 응답 원문 JSON
	 */
	record Turn(String id, String kind, String baseId, long at, String query, String request, String response) {
	}

}
