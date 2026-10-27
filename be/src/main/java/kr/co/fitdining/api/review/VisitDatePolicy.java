package kr.co.fitdining.api.review;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

/** 방문일은 KST 오늘부터 한 달 전까지 고를 수 있다(D-4). */
public record VisitDatePolicy(LocalDate min, LocalDate max) {

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	public static VisitDatePolicy at(Clock clock) {
		LocalDate today = LocalDate.ofInstant(clock.instant(), SEOUL);
		return new VisitDatePolicy(today.minusMonths(1), today);
	}

	public boolean contains(LocalDate date) {
		return !date.isBefore(min) && !date.isAfter(max);
	}

}
