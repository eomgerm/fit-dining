package kr.co.fitdining.api.meetup.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/** 모임 날짜·시간을 고를 수 있는지와 모임을 지울 시각(AC-1, AC-2, D-23). 날짜는 모두 KST로 판정한다. */
public final class MeetupSchedule {

	private MeetupSchedule() {
	}

	/**
	 * @param date 모임 날짜. 없을 수 있다.
	 * @param time 모임 시각. 날짜가 있어야 한다.
	 * @param now 지금
	 * @return 날짜가 오늘부터 {@link MeetupLimits#DATE_RANGE_DAYS}일 뒤까지이고, 오늘이면 시각이 지나지 않았을 때 참
	 */
	public static boolean selectable(LocalDate date, LocalTime time, Instant now) {
		if (date == null) {
			return time == null;
		}
		ZonedDateTime local = now.atZone(MeetupLimits.SEOUL);
		LocalDate today = local.toLocalDate();
		if (date.isBefore(today) || date.isAfter(today.plusDays(MeetupLimits.DATE_RANGE_DAYS))) {
			return false;
		}
		return time == null || !date.equals(today) || !time.isBefore(local.toLocalTime());
	}

	/**
	 * 모임 날짜 + 8일의 0시(KST), 곧 모임 날짜 + 7일이 끝날 때다. 날짜가 없으면 {@code now}의 날짜를 기준으로 한다.
	 *
	 * @param date 모임 날짜. 없을 수 있다.
	 * @param now 날짜가 없을 때의 기준 시각(만든 시각이나 날짜를 비운 시각)
	 * @return 모임을 지울 시각
	 */
	public static Instant expiresAt(LocalDate date, Instant now) {
		LocalDate base = date != null ? date : now.atZone(MeetupLimits.SEOUL).toLocalDate();
		return base.plusDays(MeetupLimits.KEEP_DAYS + 1L).atStartOfDay(MeetupLimits.SEOUL).toInstant();
	}

	/** @return 모임을 열 수 있는 마지막 날(KST). 지우는 날의 전날이다. */
	public static LocalDate lastOpenDay(Instant expiresAt) {
		return expiresAt.atZone(MeetupLimits.SEOUL).toLocalDate().minusDays(1);
	}

}
