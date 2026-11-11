package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MeetupTextTest {

	@Test
	@DisplayName("공백제거_앞뒤의전각공백과줄바꿈을_지운다")
	void trimToNull_unicodeSpaces_trimmed() {
		assertThat(MeetupText.trimToNull("　 회식 자리\n")).isEqualTo("회식 자리");
	}

	@Test
	@DisplayName("공백제거_공백뿐이면_null이다")
	void trimToNull_blank_null() {
		assertThat(MeetupText.trimToNull("  \t")).isNull();
		assertThat(MeetupText.trimToNull(null)).isNull();
	}

	@Test
	@DisplayName("길이_이모지는_한글자로센다")
	void length_emoji_countsCodePoints() {
		assertThat(MeetupText.length("곱창🍺")).isEqualTo(3);
	}

}
