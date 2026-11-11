package kr.co.fitdining.api.meetup.domain;

/** 모임장이 고른 업종(PRD D-40). 빼면 식당이다. */
public enum MeetupCategory {
	RESTAURANT,
	CAFE,
	BAR,
	/** 상관없음. 업종으로 거르지 않는다. */
	ANY
}
