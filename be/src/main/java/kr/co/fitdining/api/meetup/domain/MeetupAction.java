package kr.co.fitdining.api.meetup.domain;

/** 스냅숏의 {@code allowed}에 담는 동작(D-3). FE는 이 목록으로만 버튼을 보인다. */
public enum MeetupAction {
	/** 모임 정보의 모든 항목 수정 */
	EDIT_INFO,
	/** 모임 정보의 날짜·시간만 수정 */
	EDIT_DATE,
	/** 다른 사람의 프로필 지우기 */
	REMOVE_PROFILE,
	/** 추천받기, 다시 추천받기 */
	CALCULATE,
	OPEN_POLL,
	/** 결과나 닫힌 투표의 후보 중에서 정하기 */
	DECIDE,
	CLOSE_POLL,
	/** 동점으로 닫힌 투표를 다시 열기 */
	REOPEN_POLL,
	CHANGE_DECISION,
	CANCEL_DECISION,
	/** 처음 왔어요, 내 이름 고르기 */
	JOIN,
	/** 내 취향 수정 */
	EDIT_TASTE,
	VOTE,
	/** 비회원 프로필을 로그인한 회원의 프로필로 바꾸기 */
	LINK_ACCOUNT
}
