package kr.co.fitdining.api.meetup.domain;

/** 요청한 사람의 역할(D-7). */
public enum MeetupRole {
	/** 모임을 만든 회원. 자기 프로필이 없어도 모임장이다. */
	HOST,
	/** 이 모임에 프로필이 있는 사람 */
	PARTICIPANT,
	/** 프로필 없이 보는 사람 */
	VIEWER
}
