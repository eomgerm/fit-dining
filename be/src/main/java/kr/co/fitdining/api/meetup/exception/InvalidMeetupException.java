package kr.co.fitdining.api.meetup.exception;

/** 형식은 맞지만 받을 수 없는 값(지난 날짜, 고를 수 없는 지역, 긴 설명 등). 400이다. */
public class InvalidMeetupException extends RuntimeException {

	public InvalidMeetupException() {
		super(null, null, false, false);
	}

}
