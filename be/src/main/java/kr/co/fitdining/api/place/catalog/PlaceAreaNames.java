package kr.co.fitdining.api.place.catalog;

import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;

/**
 * 장소가 있는 역과 동.
 *
 * @param stations 장소의 가까운 역
 * @param dongs 장소 주소의 동 이름
 */
public record PlaceAreaNames(List<Station> stations, List<String> dongs) {
}
