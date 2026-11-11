package kr.co.fitdining.api.meetup.area;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.stereotype.Component;

/** 장소 Mock 모드의 장소 데이터. Mock 검색 엔진의 고정 장소를 읽는다. */
@Component
@ConditionalOnBooleanProperty("place.mock.enabled")
class MockMeetupPlaces implements MeetupPlaces {

	private final List<MeetupArea> areas;
	private final Map<Long, PlaceDetailResponse> places;

	MockMeetupPlaces(PlaceSearchEngine engine) {
		List<PlaceDetailResponse> found = engine.placeIds().stream().map(engine::findPlace).flatMap(Optional::stream)
				.toList();
		Set<String> stations = new LinkedHashSet<>();
		Set<String> dongs = new LinkedHashSet<>();
		for (PlaceDetailResponse place : found) {
			if (place.place().station() != null) {
				stations.add(place.place().station().shortName());
			}
			MockPlaceAreas.dong(place.address()).ifPresent(dongs::add);
		}
		this.areas = Stream.concat(
				stations.stream().sorted().map(name -> new MeetupArea(AreaKind.STATION, name)),
				dongs.stream().sorted().map(name -> new MeetupArea(AreaKind.DONG, name))).toList();
		this.places = found.stream().collect(Collectors.toMap(place -> place.place().id(), Function.identity(),
				(first, second) -> first));
	}

	@Override
	public List<MeetupArea> areas() {
		return areas;
	}

	@Override
	public Map<Long, PlaceDetailResponse> details(Collection<Long> ids) {
		return ids.stream().map(places::get).filter(Objects::nonNull)
				.collect(Collectors.toMap(place -> place.place().id(), Function.identity(), (a, b) -> a));
	}

}
