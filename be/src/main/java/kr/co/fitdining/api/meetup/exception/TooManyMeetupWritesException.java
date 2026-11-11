package kr.co.fitdining.api.meetup.exception;

/** 로그인 없는 쓰기 한도를 넘었다. 429다(D-8). */
public class TooManyMeetupWritesException extends RuntimeException {

	public TooManyMeetupWritesException() {
		super(null, null, false, false);
	}

}
