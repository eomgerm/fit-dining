package kr.co.fitdining.api.meetup.area;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;

/**
 * 모임이 읽는 장소 데이터의 포트. 장소 카탈로그는 DB 모드에만 있어서 장소 Mock 모드와 DB 모드의 구현을 따로 둔다.
 * 어느 구현을 쓸지는 이미 있는 장소 Mock 모드 설정이 정한다(D-11, D-27).
 */
public interface MeetupPlaces {

	/**
	 * 장소가 하나라도 있는 역과 동.
	 *
	 * @return 역 먼저, 그다음 동. 같은 종류 안에서는 구현이 정한 순서다.
	 */
	List<MeetupArea> areas();

	/**
	 * 결과 카드에 붙일 장소 상세(D-9).
	 *
	 * @param ids 장소 id
	 * @return id별 상세. 없는 장소는 빠진다.
	 */
	Map<Long, PlaceDetailResponse> details(Collection<Long> ids);

}
