package kr.co.fitdining.api.meetup.domain;

/** 결과의 두 묶음. 선언 순서가 결과의 순서다(D-18). */
public enum ResultGroup {
	/** 덜 맞는 사람이 없다 */
	ALL_FIT,
	/** 덜 맞는 사람이 있다 */
	SOME_MISFIT
}
