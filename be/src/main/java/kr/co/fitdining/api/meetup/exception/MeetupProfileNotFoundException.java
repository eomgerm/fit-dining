package kr.co.fitdining.api.meetup.exception;

/** 이 모임에 없는 프로필. 404다. */
public class MeetupProfileNotFoundException extends RuntimeException {

	public MeetupProfileNotFoundException() {
		super(null, null, false, false);
	}

}
