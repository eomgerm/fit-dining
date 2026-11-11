package kr.co.fitdining.api.meetup.recommend;

/** 추천기가 지금 추천할 수 없다. 계산은 실패가 된다. */
public class MeetupRecommenderUnavailableException extends RuntimeException {

	public MeetupRecommenderUnavailableException() {
		super(null, null, false, false);
	}

}
