package kr.co.fitdining.api.meetup.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;

/** 모임 날짜·시간을 고를 수 있는지와 모임 뒤인지(AC-1, AC-64, D-3). 날짜는 모두 KST로 판정한다. */
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
	 * @param phase 저장한 상태
	 * @param meetDate 모임 날짜. 없으면 모임 뒤가 없다(D-36).
	 * @param now 지금
	 * @return 정한 곳과 모임 날짜가 있고 오늘이 모임 날짜 당일 이후일 때 참
	 */
	public static boolean afterMeetup(MeetupPhase phase, LocalDate meetDate, Instant now) {
		return phase == MeetupPhase.DECIDED && meetDate != null
				&& !now.atZone(MeetupLimits.SEOUL).toLocalDate().isBefore(meetDate);
	}

}
