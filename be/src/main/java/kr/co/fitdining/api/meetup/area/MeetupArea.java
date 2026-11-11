package kr.co.fitdining.api.meetup.area;

import kr.co.fitdining.api.meetup.domain.AreaKind;

/**
 * 모임 지역으로 고를 수 있는 역이나 동.
 *
 * @param kind {@code STATION}이나 {@code DONG}
 * @param name 역은 "역"을 뺀 역 이름(선릉), 동은 동 이름(역삼동)
 */
public record MeetupArea(AreaKind kind, String name) {

	/** 화면과 찾기에 쓰는 이름. 역은 "역"을 붙인다. */
	public String label() {
		return kind == AreaKind.STATION ? name + "역" : name;
	}

}
