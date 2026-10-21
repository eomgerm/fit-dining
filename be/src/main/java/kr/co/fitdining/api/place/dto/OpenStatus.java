package kr.co.fitdining.api.place.dto;

/** 요청 시각 기준 영업 상태. 검색 카드와 장소 상세가 함께 쓴다. */
public enum OpenStatus {
	/** 영업 중 */
	OPEN,
	/** 곧 마감. 마감 60분 전부터 마감 전까지다. */
	CLOSING_SOON,
	/** 브레이크타임 */
	BREAK,
	/** 영업 종료. 영업시간 밖이거나 휴무일이다. */
	CLOSED,
	/** 알 수 없음. 화면에 표시하지 않는다. */
	UNKNOWN
}
