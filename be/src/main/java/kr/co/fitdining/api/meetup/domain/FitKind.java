package kr.co.fitdining.api.meetup.domain;

/** 결과 카드의 잘 맞는 사람 표시(D-18) */
public enum FitKind {
	/** 모두에게 잘 맞는다 */
	ALL,
	/** 추천에 반영된 사람에게 잘 맞는다. 계산 뒤에 들어온 사람이 있을 때다. */
	COUNT,
	/** 대체로 맞는다. 근거가 없는 항목이 있다. */
	MOSTLY,
	/** 덜 맞는 사람이 있다 */
	MISFIT
}
