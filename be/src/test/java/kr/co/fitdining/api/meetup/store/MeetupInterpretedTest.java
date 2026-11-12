package kr.co.fitdining.api.meetup.store;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 해석 결과를 두는 규칙(AC-47, D-4) */
class MeetupInterpretedTest {

	static final Instant NOW = Instant.parse("2026-11-12T03:00:00Z");
	static final MeetupInterpretation PARSED = new MeetupInterpretation(Map.of("version", 3),
			new MeetupInterpretation.Summary(true));

	static Meetup meetup(String description) {
		return new Meetup("code", "host", AreaKind.STATION, "선릉", MeetupCategory.RESTAURANT, null, null, null,
				description, NOW, NOW);
	}

	@Test
	@DisplayName("해석_해석하는동안설명이바뀌었으면_두지않는다")
	void interpreted_descriptionChanged_ignored() {
		Meetup meetup = meetup("조용한 곳");

		assertThat(meetup.interpreted("곱창 먹을 곳", PARSED)).isFalse();
		assertThat(meetup.getParsedConditions()).isNull();
		assertThat(meetup.interpreted("조용한 곳", PARSED)).isTrue();
		assertThat(meetup.getParsedConditions()).isEqualTo(PARSED);
	}

	@Test
	@DisplayName("수정_설명이바뀌면_저장한해석을지우고그대로면둔다")
	void edit_descriptionChanged_clears() {
		Meetup meetup = meetup("조용한 곳");
		meetup.interpreted("조용한 곳", PARSED);

		meetup.edit(AreaKind.STATION, "선릉", MeetupCategory.RESTAURANT, null, null, 4, "조용한 곳", NOW, NOW);
		assertThat(meetup.getParsedConditions()).isEqualTo(PARSED);

		meetup.edit(AreaKind.STATION, "선릉", MeetupCategory.RESTAURANT, null, null, 4, "곱창 먹을 곳", NOW, NOW);
		assertThat(meetup.getParsedConditions()).isNull();
	}

}
