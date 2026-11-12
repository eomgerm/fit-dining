package kr.co.fitdining.api.searchthread;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * turn 본문의 형식 규칙(search-thread spec "형식 규칙", D-4)을 HTTP 없이 본다. 어긴 규칙 이름(예외 메시지)까지 확인한다.
 * HTTP 400은 {@code SearchThreadPersistenceTest$Format}이 D-16이 이름을 적은 경우로 본다.
 */
class TurnFormatTest {

	private static final String TURN = "entry-11111111-2222-3333-4444-555555555555";
	private static final String VALID = "{\"id\":\"" + TURN + "\",\"kind\":\"new\",\"at\":1,\"request\":{\"query\":\"q\"},"
			+ "\"response\":{\"items\":[],\"totalCount\":0,\"conditions\":{}}}";

	private static TurnFormat.Turn parse(String body) {
		return TurnFormat.parse(TURN, body.replace("$ID", TURN).getBytes(StandardCharsets.UTF_8));
	}

	/** {@code $ID}는 경로의 turn id로 바꾼다. 본문은 HTTP로 보낼 때와 같은 UTF-8 바이트이고, {@code \\uXXXX}는 JSON 이스케이프다 */
	@ParameterizedTest(name = "[{index}] {1}")
	@CsvSource(delimiter = '|', quoteCharacter = '`', textBlock = """
			`{`|body
			`[]`|body
			`null`|body
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}},"extra":1}`|field
			`{"id":"entry-11111111-2222-3333-4444-555555555556","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|id
			`{"id":"$ID","kind":"other","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|kind
			`{"id":"$ID","kind":"new","baseId":null,"at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|baseId
			`{"id":"$ID","kind":"new","at":1.5,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|at
			`{"id":"$ID","kind":"new","at":-1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|at
			`{"id":"$ID","kind":"new","at":8640000000000001,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|at
			`{"id":"$ID","kind":"new","at":"1","request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|at
			`{"id":"$ID","kind":"new","request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|at
			`{"id":"$ID","kind":"new","at":1,"request":{"query":""},"response":{"items":[],"totalCount":0,"conditions":{}}}`|query
			`{"id":"$ID","kind":"new","at":1,"request":{"query":" \\n\\t "},"response":{"items":[],"totalCount":0,"conditions":{}}}`|query
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"\\u00a0"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|query
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"\\u3000\\ufeff"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|query
			`{"id":"$ID","kind":"new","at":1,"request":{"query":1},"response":{"items":[],"totalCount":0,"conditions":{}}}`|query
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q","cursor":null},"response":{"items":[],"totalCount":0,"conditions":{}}}`|request
			`{"id":"$ID","kind":"new","at":1,"request":[],"response":{"items":[],"totalCount":0,"conditions":{}}}`|request
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{},"nextCursor":null}}`|response
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":{},"totalCount":0,"conditions":{}}}`|response
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":-1,"conditions":{}}}`|response
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":1.5,"conditions":{}}}`|response
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":null}}`|response
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q\\u0000"},"response":{"items":[],"totalCount":0,"conditions":{}}}`|string
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[{"a\\u0000":1}],"totalCount":0,"conditions":{}}}`|string
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":["\\ud800"],"totalCount":0,"conditions":{}}}`|string
			`{"id":"$ID","kind":"new","at":1,"request":{"query":"q"},"response":{"items":[],"totalCount":0,"conditions":{"\\udc00x":1}}}`|body
			""")
	@DisplayName("형식_규칙을어긴본문은_그규칙이름으로거부한다")
	void parse_badFormat_rejectedWithRule(String body, String rule) {
		assertThatThrownBy(() -> parse(body))
				.isInstanceOf(InvalidSearchThreadException.class)
				.hasMessage(rule);
	}

	@Test
	@DisplayName("형식_규칙에맞는본문은_받는다")
	void parse_validBody_accepted() {
		TurnFormat.Turn turn = parse(VALID);

		assertThat(turn.id()).isEqualTo(TURN);
		assertThat(turn.kind()).isEqualTo("new");
		assertThat(turn.at()).isEqualTo(1);
		assertThat(turn.query()).isEqualTo("q");
	}

}
