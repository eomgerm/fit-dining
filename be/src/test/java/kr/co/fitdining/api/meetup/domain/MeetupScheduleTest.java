package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** 날짜 검증과 모임 뒤 판정을 KST 자정 전후의 고정 시각으로 확인한다(AC-1, AC-64). */
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
	@DisplayName("모임 뒤")
	class AfterMeetup {

		@Test
		@DisplayName("모임뒤_정한곳이없으면_아니다")
		void afterMeetup_notDecided_false() {
			for (MeetupPhase phase : List.of(MeetupPhase.WAITING, MeetupPhase.RESULT, MeetupPhase.VOTING)) {
				assertThat(MeetupSchedule.afterMeetup(phase, NOV_11, AFTER_MIDNIGHT)).isFalse();
			}
		}

		@Test
		@DisplayName("모임뒤_모임날짜당일0시KST부터다")
		void afterMeetup_fromMeetDateMidnightKst() {
			assertThat(MeetupSchedule.afterMeetup(MeetupPhase.DECIDED, NOV_12, BEFORE_MIDNIGHT)).isFalse();
			assertThat(MeetupSchedule.afterMeetup(MeetupPhase.DECIDED, NOV_12, AFTER_MIDNIGHT)).isTrue();
			assertThat(MeetupSchedule.afterMeetup(MeetupPhase.DECIDED, NOV_11, AFTER_MIDNIGHT)).isTrue();
		}

		@Test
		@DisplayName("모임뒤_날짜가없으면_없다")
		void afterMeetup_withoutDate_never() {
			assertThat(MeetupSchedule.afterMeetup(MeetupPhase.DECIDED, null, AFTER_MIDNIGHT)).isFalse();
		}

	}

}
