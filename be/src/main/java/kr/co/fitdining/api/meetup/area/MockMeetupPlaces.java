package kr.co.fitdining.api.meetup.area;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.stereotype.Component;

/**
 * 장소 Mock 모드의 장소 데이터. Mock 검색 엔진의 고정 장소를 읽는다. Mock 장소에는 동 칸이 없어 도로명 주소 끝의
 * "(서초동)" 같은 표기에서 동을 얻는다.
 */
@Component
@ConditionalOnBooleanProperty("place.mock.enabled")
class MockMeetupPlaces implements MeetupPlaces {

	private static final Pattern DONG_NOTE = Pattern.compile("\\(([^(),\\s]+동)\\)");

	private final List<MeetupArea> areas;

	MockMeetupPlaces(PlaceSearchEngine engine) {
		List<PlaceDetailResponse> places = engine.placeIds().stream().map(engine::findPlace).flatMap(Optional::stream)
				.toList();
		Set<String> stations = new LinkedHashSet<>();
		Set<String> dongs = new LinkedHashSet<>();
		for (PlaceDetailResponse place : places) {
			if (place.place().station() != null) {
				stations.add(place.place().station().shortName());
			}
			dong(place.address()).ifPresent(dongs::add);
		}
		this.areas = Stream.concat(
				stations.stream().sorted().map(name -> new MeetupArea(AreaKind.STATION, name)),
				dongs.stream().sorted().map(name -> new MeetupArea(AreaKind.DONG, name))).toList();
	}

	@Override
	public List<MeetupArea> areas() {
		return areas;
	}

	private static Optional<String> dong(String address) {
		if (address == null) {
			return Optional.empty();
		}
		Matcher matcher = DONG_NOTE.matcher(address);
		return matcher.find() ? Optional.of(matcher.group(1)) : Optional.empty();
	}

}
