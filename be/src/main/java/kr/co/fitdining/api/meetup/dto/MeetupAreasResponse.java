package kr.co.fitdining.api.meetup.dto;

import java.util.List;
import kr.co.fitdining.api.meetup.domain.AreaKind;

/**
 * 지역 찾기 결과.
 *
 * @param items 찾는 말이 이름에 들어 있는 역과 동. 없으면 빈 목록이다.
 */
public record MeetupAreasResponse(List<Item> items) {

	/**
	 * @param kind {@code STATION}이나 {@code DONG}
	 * @param name 역은 "역"을 뺀 이름, 동은 동 이름. 모임 만들기 요청에 그대로 보낸다.
	 */
	public record Item(AreaKind kind, String name) {
	}

}
