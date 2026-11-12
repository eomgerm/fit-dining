package kr.co.fitdining.api.meetup.domain;

/** 결과의 묶음. 선언 순서가 결과의 순서다(D-18). */
public enum ResultGroup {
	/** 덜 맞는 사람이 없다 */
	ALL_FIT,
	/** 덜 맞는 사람이 있다 */
	SOME_MISFIT,
	/** 다른 곳에는 모임 점수가 있는데 이곳에는 없다. 점수를 매길 근거가 적어 맨 뒤에 둔다. */
	UNSCORED
}
