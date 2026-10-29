package kr.co.fitdining.api.place.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Break;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** 테스트 안에서 만든 영업시간으로 영업 상태 판정을 확인한다. */
class OpenStatusCalculatorTest {

	/** 날짜와 요일. 2026-10-19가 월요일이다. */
	private static final Map<DayCode, String> DATES = Map.of(
			DayCode.MON, "2026-10-19", DayCode.TUE, "2026-10-20", DayCode.WED, "2026-10-21",
			DayCode.THU, "2026-10-22", DayCode.FRI, "2026-10-23", DayCode.SAT, "2026-10-24",
			DayCode.SUN, "2026-10-25");

	/** 요일별 영업시간. 적지 않은 요일은 정보 없음이다. */
	private static final class Week {

		private final Map<DayCode, Hours> days = new EnumMap<>(DayCode.class);

		Week open(DayCode day, String open, String close, Break... breaks) {
			days.put(day, new Hours(day, open, close, List.of(breaks), List.of(), false));
			return this;
		}

		Week everyDay(String open, String close) {
			Arrays.stream(DayCode.values()).forEach(day -> open(day, open, close));
			return this;
		}

		Week closed(DayCode day) {
			days.put(day, new Hours(day, null, null, List.of(), List.of(), true));
			return this;
		}

		List<Hours> hours() {
			return Arrays.stream(DayCode.values())
					.map(day -> days.getOrDefault(day, new Hours(day, null, null, List.of(), List.of(), false)))
					.toList();
		}

		OpenStatus at(DayCode day, String time) {
			return OpenStatusCalculator.openStatus(hours(), LocalDateTime.parse(DATES.get(day) + "T" + time));
		}
	}

	private static Break pause(String start, String end) {
		return new Break(start, end);
	}

	/** 평일 11:00~22:00, 브레이크 15:00~17:00, 토요일 정보 없음, 일요일 휴무. */
	private final Week weekdays = new Week()
			.open(DayCode.MON, "11:00", "22:00", pause("15:00", "17:00"))
			.open(DayCode.TUE, "11:00", "22:00", pause("15:00", "17:00"))
			.open(DayCode.WED, "11:00", "22:00", pause("15:00", "17:00"))
			.open(DayCode.THU, "11:00", "22:00", pause("15:00", "17:00"))
			.open(DayCode.FRI, "11:00", "22:00", pause("15:00", "17:00"))
			.closed(DayCode.SUN);

	@ParameterizedTest(name = "{0} → {1}")
	@CsvSource({
			"10:59, CLOSED",
			"11:00, OPEN",
			"14:59, OPEN",
			"15:00, BREAK",
			"16:59, BREAK",
			"17:00, OPEN",
			"20:59, OPEN",
			"21:00, CLOSING_SOON",
			"21:59, CLOSING_SOON",
			"22:00, CLOSED",
			"23:59, CLOSED"
	})
	@DisplayName("영업상태_하루안의영업시간이면_영업중브레이크곧마감과개점전마감뒤를가른다")
	void openStatus_sameDayHours_classifiesTime(String time, OpenStatus expected) {
		assertThat(weekdays.at(DayCode.WED, time)).isEqualTo(expected);
	}

	@Test
	@DisplayName("영업상태_휴무일은_CLOSED다")
	void openStatus_closedDay_closed() {
		assertThat(weekdays.at(DayCode.SUN, "12:00")).isEqualTo(OpenStatus.CLOSED);
	}

	@Test
	@DisplayName("영업상태_브레이크가없는날은_오후에도영업중이다")
	void openStatus_noBreak_openInAfternoon() {
		Week noBreak = new Week().everyDay("11:00", "22:00");

		assertThat(noBreak.at(DayCode.WED, "15:30")).isEqualTo(OpenStatus.OPEN);
	}

	@ParameterizedTest(name = "화 {0} → {1}")
	@CsvSource({
			"00:59, OPEN",
			"01:00, CLOSING_SOON",
			"01:30, CLOSING_SOON",
			"02:00, CLOSED"
	})
	@DisplayName("영업상태_자정을넘는영업은_다음날새벽까지어제구간으로판정한다")
	void openStatus_overnight_continuesIntoNextDay(String time, OpenStatus expected) {
		Week overnight = new Week().open(DayCode.MON, "17:00", "02:00").closed(DayCode.TUE);

		assertThat(overnight.at(DayCode.TUE, time)).isEqualTo(expected);
	}

	@ParameterizedTest(name = "화 {0} → {1}")
	@CsvSource({
			"00:59, OPEN",
			"03:00, UNKNOWN"
	})
	@DisplayName("영업상태_오늘이정보없음이면_어제구간밖은UNKNOWN이다")
	void openStatus_overnightIntoUnknownDay_unknownAfterwards(String time, OpenStatus expected) {
		Week overnight = new Week().open(DayCode.MON, "17:00", "02:00");

		assertThat(overnight.at(DayCode.TUE, time)).isEqualTo(expected);
	}

	@ParameterizedTest
	@ValueSource(strings = {"MON", "WED", "SUN"})
	@DisplayName("영업상태_7일내내24시간이면_밤에도곧마감이아니다")
	void openStatus_allDayEveryDay_openAtNight(DayCode day) {
		Week allDay = new Week().everyDay("00:00", "00:00");

		assertThat(allDay.at(day, "23:30")).isEqualTo(OpenStatus.OPEN);
		assertThat(allDay.at(day, "00:00")).isEqualTo(OpenStatus.OPEN);
	}

	@Test
	@DisplayName("영업상태_다음날로이어지지않는24시간은_자정전에곧마감이다")
	void openStatus_allDayNotContinued_closingSoonBeforeMidnight() {
		Week oneDay = new Week().open(DayCode.MON, "00:00", "00:00").closed(DayCode.TUE);

		assertThat(oneDay.at(DayCode.MON, "22:59")).isEqualTo(OpenStatus.OPEN);
		assertThat(oneDay.at(DayCode.MON, "23:30")).isEqualTo(OpenStatus.CLOSING_SOON);
		assertThat(oneDay.at(DayCode.TUE, "00:00")).isEqualTo(OpenStatus.CLOSED);
	}

	@Test
	@DisplayName("영업상태_마감에다음날개점이이어지면_한구간으로보고그끝으로곧마감을가른다")
	void openStatus_closeMeetsNextOpen_mergedIntoOneInterval() {
		Week chained = new Week().open(DayCode.MON, "00:00", "00:00").open(DayCode.TUE, "00:00", "02:00");

		assertThat(chained.at(DayCode.MON, "23:30")).isEqualTo(OpenStatus.OPEN);
		assertThat(chained.at(DayCode.TUE, "01:30")).isEqualTo(OpenStatus.CLOSING_SOON);
	}

	@ParameterizedTest(name = "{0} → {1}")
	@CsvSource({
			"09:00, OPEN",
			"09:30, BREAK",
			"12:00, OPEN",
			"14:30, BREAK",
			"17:59, BREAK",
			"18:00, OPEN"
	})
	@DisplayName("영업상태_브레이크가여러개면_각브레이크안을BREAK로본다")
	void openStatus_multipleBreaks_eachIsBreak(String time, OpenStatus expected) {
		Week twoBreaks = new Week().open(DayCode.WED, "06:30", "21:30", pause("09:30", "12:00"),
				pause("14:30", "18:00"));

		assertThat(twoBreaks.at(DayCode.WED, time)).isEqualTo(expected);
	}

	@Test
	@DisplayName("영업상태_자정넘은구간의브레이크도_그구간에서판정한다")
	void openStatus_breakAfterMidnight_breakInYesterdayInterval() {
		Week overnight = new Week().open(DayCode.MON, "18:00", "04:00", pause("00:30", "01:00"))
				.closed(DayCode.TUE);

		assertThat(overnight.at(DayCode.TUE, "00:45")).isEqualTo(OpenStatus.BREAK);
		assertThat(overnight.at(DayCode.MON, "18:30")).isEqualTo(OpenStatus.OPEN);
	}

	@ParameterizedTest(name = "화 {0} → {1}")
	@CsvSource({
			"03:00, UNKNOWN",
			"08:00, UNKNOWN",
			"09:00, OPEN",
			"21:30, CLOSING_SOON",
			"22:00, CLOSED"
	})
	@DisplayName("영업상태_어제가정보없음이면_오늘첫구간전은UNKNOWN이고_그뒤는오늘시간표대로다")
	void openStatus_yesterdayUnknown_unknownBeforeFirstOpen(String time, OpenStatus expected) {
		Week week = new Week().open(DayCode.TUE, "09:00", "22:00");

		assertThat(week.at(DayCode.TUE, time)).isEqualTo(expected);
	}

	@Test
	@DisplayName("영업상태_오늘이휴무면_어제가정보없음이어도CLOSED다")
	void openStatus_todayClosedYesterdayUnknown_closed() {
		Week week = new Week().closed(DayCode.TUE);

		assertThat(week.at(DayCode.TUE, "03:00")).isEqualTo(OpenStatus.CLOSED);
	}

	@Test
	@DisplayName("영업상태_어제가휴무면_오늘개점전은CLOSED다")
	void openStatus_yesterdayClosed_closedBeforeOpen() {
		Week week = new Week().closed(DayCode.MON).open(DayCode.TUE, "09:00", "22:00");

		assertThat(week.at(DayCode.TUE, "08:00")).isEqualTo(OpenStatus.CLOSED);
	}

}
