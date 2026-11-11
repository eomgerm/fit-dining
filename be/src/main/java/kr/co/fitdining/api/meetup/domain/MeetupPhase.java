package kr.co.fitdining.api.meetup.domain;

/**
 * 저장하는 모임 상태(D-3). 계산 중은 실행 중인 계산 행으로, 모임 뒤는 정한 곳과 날짜로, 닫힘은 모임 행이 없는 것으로
 * 얻는다.
 */
public enum MeetupPhase {
	/** 모임을 만든 뒤 추천을 받기 전 */
	WAITING,
	/** 추천을 받은 뒤 */
	RESULT,
	/** 투표가 열렸거나 마감했지만 정한 곳이 없을 때 */
	VOTING,
	/** 정한 곳이 있을 때 */
	DECIDED
}
