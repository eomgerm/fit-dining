package kr.co.fitdining.api.meetup.exception;

/** 아직 성공한 계산이 없다. 404로 응답한다. */
public class MeetupResultNotFoundException extends RuntimeException {

	public MeetupResultNotFoundException() {
		super(null, null, false, false);
	}

}
