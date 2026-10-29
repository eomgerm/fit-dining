package kr.co.fitdining.api.place.catalog;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;

/**
 * 영업 상태 규칙(place-catalog spec)을 따른다. 요일 d의 영업 구간은 d의 open부터 close까지이고, close가 open과 같거나
 * 이르면 다음 날 close까지다. 구간은 시작 포함, 끝 제외이고, 끝이 다음 요일 구간의 시작과 같으면 한 구간으로 잇는다.
 * 브레이크 시작 전은 곧 마감으로 보지 않는다. 시각은 모두 오늘 0시부터의 분으로 계산한다.
 */
public final class OpenStatusCalculator {

	private static final int CLOSING_SOON_MINUTES = 60;
	private static final int DAY_MINUTES = 24 * 60;

	private OpenStatusCalculator() {
	}

	/**
	 * 요청 시각의 영업 상태를 계산한다.
	 *
	 * @param hours 요일별 영업시간 7개(월~일)
	 * @param now 서울 시각
	 * @return 영업 상태
	 */
	public static OpenStatus openStatus(List<Hours> hours, LocalDateTime now) {
		int today = now.getDayOfWeek().ordinal();
		int minute = now.getHour() * 60 + now.getMinute();
		for (int offset = -1; offset <= 0; offset++) {
			Interval interval = interval(hours, today + offset, offset);
			if (interval != null && minute >= interval.start() && minute < interval.end()) {
				if (interval.breaks().stream().anyMatch(b -> minute >= b.start() && minute < b.end())) {
					return OpenStatus.BREAK;
				}
				int end = mergedEnd(hours, today + offset, offset, interval.end());
				return minute >= end - CLOSING_SOON_MINUTES ? OpenStatus.CLOSING_SOON : OpenStatus.OPEN;
			}
		}
		Hours todayHours = day(hours, today);
		if (isUnknown(todayHours)) {
			return OpenStatus.UNKNOWN;
		}
		Interval todayInterval = interval(hours, today, 0);
		if (todayInterval != null && minute < todayInterval.start() && isUnknown(day(hours, today - 1))) {
			return OpenStatus.UNKNOWN;
		}
		return OpenStatus.CLOSED;
	}

	/** 끝이 다음 요일 구간의 시작과 같은 동안 잇는다. 7일 내내 이어지면 일주일 뒤에서 멈춘다. */
	private static int mergedEnd(List<Hours> hours, int dayIndex, int offset, int end) {
		for (int next = 1; next <= DayCode.values().length; next++) {
			Interval following = interval(hours, dayIndex + next, offset + next);
			if (following == null || following.start() != end) {
				break;
			}
			end = following.end();
		}
		return end;
	}

	/** dayIndex 요일의 영업 구간을 오늘 0시 기준 분으로. offset은 오늘과의 날짜 차이다. 영업 시각이 없으면 null. */
	private static Interval interval(List<Hours> hours, int dayIndex, int offset) {
		Hours day = day(hours, dayIndex);
		if (day == null || Boolean.TRUE.equals(day.closed()) || day.open() == null || day.close() == null) {
			return null;
		}
		int base = offset * DAY_MINUTES;
		int open = minutes(day.open());
		int close = minutes(day.close());
		List<Span> breaks = day.breaks() == null ? List.of() : day.breaks().stream()
				.map(b -> {
					int start = base + minutes(b.start()) + (minutes(b.start()) < open ? DAY_MINUTES : 0);
					int end = base + minutes(b.end()) + (minutes(b.end()) < open ? DAY_MINUTES : 0);
					return new Span(start, end > start ? end : end + DAY_MINUTES);
				})
				.toList();
		return new Interval(base + open, base + (close > open ? close : close + DAY_MINUTES), breaks);
	}

	private static Hours day(List<Hours> hours, int dayIndex) {
		DayCode code = DayCode.values()[Math.floorMod(dayIndex, DayCode.values().length)];
		return hours.stream().filter(h -> h.dayOfWeek() == code).findFirst().orElse(null);
	}

	/** 휴무가 아닌데 영업 시각이 없으면 정보 없음이다. 요일 줄이 없어도 정보 없음이다. */
	private static boolean isUnknown(Hours day) {
		return day == null || (!Boolean.TRUE.equals(day.closed()) && day.open() == null);
	}

	private static int minutes(String time) {
		LocalTime parsed = LocalTime.parse(time);
		return parsed.getHour() * 60 + parsed.getMinute();
	}

	/** 영업 구간과 그 안의 브레이크. 시작 포함, 끝 제외다. */
	private record Interval(int start, int end, List<Span> breaks) {
	}

	private record Span(int start, int end) {
	}

}
