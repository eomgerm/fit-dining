package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class VisitDatePolicyTest {

	private static VisitDatePolicy at(String instant) {
		return VisitDatePolicy.at(Clock.fixed(Instant.parse(instant), ZoneOffset.UTC));
	}

	@Test
	@DisplayName("방문일범위_KST자정직후면_KST날짜기준이다")
	void at_justAfterKstMidnight_usesKstDate() {
		VisitDatePolicy policy = at("2026-10-21T15:00:00Z");

		assertThat(policy.max()).isEqualTo(LocalDate.of(2026, 10, 22));
		assertThat(policy.min()).isEqualTo(LocalDate.of(2026, 9, 22));
	}

	@Test
	@DisplayName("방문일범위_KST자정직전이면_전날이다")
	void at_justBeforeKstMidnight_usesPreviousDate() {
		assertThat(at("2026-10-21T14:59:59Z").max()).isEqualTo(LocalDate.of(2026, 10, 21));
	}

	@Test
	@DisplayName("방문일범위_한달전날이없으면_그달마지막날이다")
	void at_monthEnd_clampsToLastDay() {
		assertThat(at("2026-03-31T03:00:00Z").min()).isEqualTo(LocalDate.of(2026, 2, 28));
	}

	@Test
	@DisplayName("방문일범위_경계일은포함하고_미래와한달전보다이전은뺀다")
	void contains_boundaries() {
		VisitDatePolicy policy = at("2026-10-21T03:00:00Z");

		assertThat(policy.contains(LocalDate.of(2026, 10, 21))).isTrue();
		assertThat(policy.contains(LocalDate.of(2026, 9, 21))).isTrue();
		assertThat(policy.contains(LocalDate.of(2026, 10, 22))).isFalse();
		assertThat(policy.contains(LocalDate.of(2026, 9, 20))).isFalse();
	}

}
