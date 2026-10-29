package kr.co.fitdining.api.place.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 정기휴무 요일에서 만드는 휴무 안내(place-lookup-db AC-14). */
class ClosedDayNoteTest {

	/** 주어진 요일은 휴무, 나머지는 영업시간이 없는(정보 없음) 줄이다. */
	private static List<Hours> closedOn(DayCode... closed) {
		Set<DayCode> closedDays = Set.of(closed);
		return Arrays.stream(DayCode.values())
				.map(day -> new Hours(day, null, null, List.of(), List.of(), closedDays.contains(day)))
				.toList();
	}

	@Test
	@DisplayName("휴무안내_하루만쉬면_매주그요일휴무다")
	void closedDayNote_singleDay() {
		assertThat(JdbcPlaceCatalog.closedDayNote(closedOn(DayCode.SUN))).isEqualTo("매주 일요일 휴무");
		assertThat(JdbcPlaceCatalog.closedDayNote(closedOn(DayCode.MON))).isEqualTo("매주 월요일 휴무");
	}

	@Test
	@DisplayName("휴무안내_여러날이면_월요일부터세어가운뎃점으로잇는다")
	void closedDayNote_severalDays_inWeekOrder() {
		assertThat(JdbcPlaceCatalog.closedDayNote(closedOn(DayCode.SUN, DayCode.SAT))).isEqualTo("매주 토·일요일 휴무");
		assertThat(JdbcPlaceCatalog.closedDayNote(closedOn(DayCode.FRI, DayCode.MON, DayCode.WED)))
				.isEqualTo("매주 월·수·금요일 휴무");
	}

	@Test
	@DisplayName("휴무안내_정기휴무가없으면_없다")
	void closedDayNote_noClosedDay_null() {
		assertThat(JdbcPlaceCatalog.closedDayNote(closedOn())).isNull();
	}

}
