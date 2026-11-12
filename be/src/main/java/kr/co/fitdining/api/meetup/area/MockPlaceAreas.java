package kr.co.fitdining.api.meetup.area;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import kr.co.fitdining.api.meetup.domain.MeetupPoint;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;

/**
 * Mock 장소가 어느 역·동이나 지점 반경에 있는지. Mock 장소에는 동 칸이 없어 도로명 주소 끝의 "(서초동)" 같은 표기에서
 * 동을 얻는다.
 */
public final class MockPlaceAreas {

	private static final Pattern DONG_NOTE = Pattern.compile("\\(([^(),\\s]+동)\\)");

	private MockPlaceAreas() {
	}

	/**
	 * @param point 지점 모임의 지점과 반경. 역·동 모임이면 null이다.
	 */
	public static boolean contains(MeetupArea area, MeetupPoint point, PlaceDetailResponse place) {
		return switch (area.kind()) {
			case STATION -> place.place().station() != null
					&& place.place().station().shortName().equals(area.name());
			case DONG -> dong(place.address()).filter(area.name()::equals).isPresent();
			case POINT -> point != null && within(point, place);
		};
	}

	static boolean within(MeetupPoint point, PlaceDetailResponse place) {
		return place.place().lat() != null && place.place().lng() != null
				&& point.contains(place.place().lat(), place.place().lng());
	}

	static Optional<String> dong(String address) {
		if (address == null) {
			return Optional.empty();
		}
		Matcher matcher = DONG_NOTE.matcher(address);
		return matcher.find() ? Optional.of(matcher.group(1)) : Optional.empty();
	}

}
