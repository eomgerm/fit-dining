package kr.co.fitdining.api.searchthread;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 목록 cursor의 해석(search-thread D-7)을 HTTP 없이 본다. HTTP 400은 {@code SearchThreadPersistenceTest$ListThreads}가
 * 시각이 long 최댓값인 위조 cursor(f8aa07f에서 500을 400으로 고친 경우)로 본다.
 */
class ThreadCursorTest {

	private static final String THREAD = "thread-11111111-2222-3333-4444-555555555555";

	private static String encode(String plain) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(plain.getBytes(StandardCharsets.UTF_8));
	}

	/**
	 * 앞의 넷은 base64url이 아니거나 내용이 형식에 맞지 않는다. {@code ==}는 패딩이고 URL에서는 {@code %3D%3D}로 온다.
	 * 뒤의 셋은 형식은 맞지만 시각이 저장될 수 있는 범위(0 ~ JS Date 상한 8.64e15) 밖인 위조 cursor다(long 최댓값, 상한 + 1, -1).
	 */
	@ParameterizedTest
	@ValueSource(strings = {"not-a-cursor", "YWJj", "MTIzfHRocmVhZC14", "==",
			"OTIyMzM3MjAzNjg1NDc3NTgwN3x0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1",
			"ODY0MDAwMDAwMDAwMDAwMXx0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1",
			"LTF8dGhyZWFkLTExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NQ"})
	@DisplayName("cursor_형식이틀리거나시각이범위밖이면_거부한다")
	void decode_badCursor_rejected(String cursor) {
		assertThatThrownBy(() -> ThreadCursor.decode(cursor))
				.isInstanceOf(InvalidSearchThreadException.class)
				.hasMessage("cursor");
	}

	@Test
	@DisplayName("cursor_위조값은_시각과thread_id를적은그대로다")
	void forgedCursors_encodeExpectedValues() {
		assertThat(encode(Long.MAX_VALUE + "|" + THREAD))
				.isEqualTo("OTIyMzM3MjAzNjg1NDc3NTgwN3x0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1");
		assertThat(encode((TurnFormat.MAX_AT_MILLIS + 1) + "|" + THREAD))
				.isEqualTo("ODY0MDAwMDAwMDAwMDAwMXx0aHJlYWQtMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1");
		assertThat(encode("-1|" + THREAD)).isEqualTo("LTF8dGhyZWFkLTExMTExMTExLTIyMjItMzMzMy00NDQ0LTU1NTU1NTU1NTU1NQ");
	}

	@Test
	@DisplayName("cursor_범위끝의시각도_만든그대로읽는다")
	void decode_boundaryAt_roundTrips() {
		for (long at : new long[] {0, TurnFormat.MAX_AT_MILLIS}) {
			ThreadCursor cursor = new ThreadCursor(at, THREAD);

			assertThat(ThreadCursor.decode(cursor.encode())).isEqualTo(cursor);
		}
	}

}
