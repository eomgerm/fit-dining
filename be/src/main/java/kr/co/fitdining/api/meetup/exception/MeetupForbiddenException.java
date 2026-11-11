package kr.co.fitdining.api.meetup.exception;

/** 모임장이 아니거나, 프로필이 없거나, 남의 회원 프로필을 고르려 했다. 403이다. */
public class MeetupForbiddenException extends RuntimeException {

	public MeetupForbiddenException() {
		super(null, null, false, false);
	}

}
