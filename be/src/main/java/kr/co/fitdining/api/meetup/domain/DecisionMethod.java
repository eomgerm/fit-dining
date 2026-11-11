package kr.co.fitdining.api.meetup.domain;

/** 정한 곳을 어떻게 정했는지(D-19). */
public enum DecisionMethod {
	/** 마감할 때 가장 많은 곳이 하나였다 */
	VOTE,
	/** 동점으로 닫힌 투표의 후보 중에서 모임장이 골랐다 */
	PICK,
	/** 모임장이 결과에서 바로 정했거나 다른 곳으로 바꿨다 */
	DIRECT
}
