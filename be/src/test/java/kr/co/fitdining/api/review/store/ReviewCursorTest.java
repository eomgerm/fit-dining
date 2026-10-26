package kr.co.fitdining.api.review.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ReviewCursorTest {

	@Test
	@DisplayName("커서_인코딩한값을해석하면_같은위치다")
	void decode_encodedCursor_returnsSamePosition() {
		ReviewCursor cursor = new ReviewCursor(Instant.parse("2026-10-21T03:00:00.123456Z"), 42);

		assertThat(ReviewCursor.decode(cursor.encode())).isEqualTo(cursor);
	}

	@Test
	@DisplayName("커서_인코딩하면_패딩없는base64url이다")
	void encode_anyCursor_hasNoPadding() {
		String encoded = new ReviewCursor(Instant.parse("2026-10-21T03:00:00Z"), 1).encode();

		assertThat(encoded).doesNotContain("=").matches("[A-Za-z0-9_-]+");
	}

	@ParameterizedTest
	@ValueSource(strings = {"!!!", "YQ==", "not a cursor"})
	@DisplayName("커서_base64url이아니거나패딩이있으면_예외다")
	void decode_notBase64UrlOrPadded_throws(String cursor) {
		assertThatThrownBy(() -> ReviewCursor.decode(cursor)).isInstanceOf(InvalidReviewCursorException.class);
	}

	@ParameterizedTest
	@ValueSource(strings = {"2026-10-21T03:00:00Z", "어제|42", "2026-10-21T03:00:00Z|숫자아님", "|"})
	@DisplayName("커서_내용이형식에맞지않으면_예외다")
	void decode_malformedContent_throws(String plain) {
		String cursor = Base64.getUrlEncoder().withoutPadding().encodeToString(plain.getBytes(StandardCharsets.UTF_8));

		assertThatThrownBy(() -> ReviewCursor.decode(cursor)).isInstanceOf(InvalidReviewCursorException.class);
	}

}
