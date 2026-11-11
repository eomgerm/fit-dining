package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** 날짜 검증과 삭제 시각을 KST 자정 전후의 고정 시각으로 확인한다(AC-1, AC-2). */
class MeetupScheduleTest {

	/** 2026-11-11 23:59:30 KST. UTC로는 아직 11일 14시대다. */
	private static final Instant BEFORE_MIDNIGHT = Instant.parse("2026-11-11T14:59:30Z");
	/** 2026-11-12 00:00:30 KST. UTC로는 아직 11일이다. */
	private static final Instant AFTER_MIDNIGHT = Instant.parse("2026-11-11T15:00:30Z");
	private static final LocalDate NOV_11 = LocalDate.of(2026, 11, 11);
	private static final LocalDate NOV_12 = LocalDate.of(2026, 11, 12);

	@Nested
	@DisplayName("고를 수 있는 날짜")
	class Selectable {

		@Test
		@DisplayName("날짜_없으면_고를수있다")
		void selectable_noDate_true() {
			assertThat(MeetupSchedule.selectable(null, null, BEFORE_MIDNIGHT)).isTrue();
		}

		@Test
		@DisplayName("날짜_시간만있으면_고를수없다")
		void selectable_timeWithoutDate_false() {
			assertThat(MeetupSchedule.selectable(null, LocalTime.of(19, 0), BEFORE_MIDNIGHT)).isFalse();
		}

		@Test
		@DisplayName("날짜_KST자정직후에어제면_고를수없다")
		void selectable_yesterdayAfterKstMidnight_false() {
			assertThat(MeetupSchedule.selectable(NOV_11, null, AFTER_MIDNIGHT)).isFalse();
			assertThat(MeetupSchedule.selectable(NOV_12, null, AFTER_MIDNIGHT)).isTrue();
		}

		@Test
		@DisplayName("날짜_30일뒤까지_고를수있다")
		void selectable_thirtyDaysAhead_boundary() {
			assertThat(MeetupSchedule.selectable(NOV_11.plusDays(30), null, BEFORE_MIDNIGHT)).isTrue();
			assertThat(MeetupSchedule.selectable(NOV_11.plusDays(31), null, BEFORE_MIDNIGHT)).isFalse();
		}

		@Test
		@DisplayName("시각_오늘인데지났으면_고를수없다")
		void selectable_pastTimeToday_false() {
			assertThat(MeetupSchedule.selectable(NOV_11, LocalTime.of(23, 59), BEFORE_MIDNIGHT)).isFalse();
			assertThat(MeetupSchedule.selectable(NOV_12, LocalTime.of(0, 0), BEFORE_MIDNIGHT)).isTrue();
		}

		@Test
		@DisplayName("시각_오늘이고아직이면_고를수있다")
		void selectable_laterTimeToday_true() {
			Instant noon = Instant.parse("2026-11-11T03:00:00Z");
			assertThat(MeetupSchedule.selectable(NOV_11, LocalTime.of(12, 0), noon)).isTrue();
			assertThat(MeetupSchedule.selectable(NOV_11, LocalTime.of(19, 0), noon)).isTrue();
		}

	}

	@Nested
	@DisplayName("삭제 시각")
	class Expiry {

		@Test
		@DisplayName("삭제시각_모임날짜가있으면_8일뒤0시KST다")
		void expiresAt_withDate_eightDaysLaterMidnight() {
			assertThat(MeetupSchedule.expiresAt(LocalDate.of(2026, 11, 14), BEFORE_MIDNIGHT))
					.isEqualTo(Instant.parse("2026-11-21T15:00:00Z"));
		}

		@Test
		@DisplayName("삭제시각_날짜가없으면_KST기준만든날의8일뒤0시다")
		void expiresAt_withoutDate_fromKstToday() {
			assertThat(MeetupSchedule.expiresAt(null, BEFORE_MIDNIGHT)).isEqualTo(Instant.parse("2026-11-18T15:00:00Z"));
			assertThat(MeetupSchedule.expiresAt(null, AFTER_MIDNIGHT)).isEqualTo(Instant.parse("2026-11-19T15:00:00Z"));
		}

		@Test
		@DisplayName("마지막날_모임날짜의7일뒤다")
		void lastOpenDay_isSevenDaysAfterDate() {
			Instant expiresAt = MeetupSchedule.expiresAt(LocalDate.of(2026, 11, 14), BEFORE_MIDNIGHT);
			assertThat(MeetupSchedule.lastOpenDay(expiresAt)).isEqualTo(LocalDate.of(2026, 11, 21));
		}

	}

}
