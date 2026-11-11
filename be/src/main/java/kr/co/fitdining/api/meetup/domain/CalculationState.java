package kr.co.fitdining.api.meetup.domain;

/** 계산 행의 상태(D-10). 모임마다 RUNNING은 하나뿐이다. */
public enum CalculationState {
	RUNNING,
	SUCCEEDED,
	FAILED
}
