package kr.co.fitdining.api.meetup.exception;

/** 없는 코드. 처음부터 없던 모임과 닫혀서 지운 모임을 구분하지 않는다(D-6). */
public class MeetupNotFoundException extends RuntimeException {

	public MeetupNotFoundException() {
		super(null, null, false, false);
	}

}
