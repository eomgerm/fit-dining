package kr.co.fitdining.api.meetup.domain;

/** 모임 지역의 종류. */
public enum AreaKind {
	/** 역. 이름은 "역"을 뺀 역 이름이다(예: 선릉). */
	STATION,
	/** 동. 이름은 동 이름이다(예: 역삼동). */
	DONG,
	/** 지도에서 고른 지점과 반경(④ 모임 지점) */
	POINT
}
