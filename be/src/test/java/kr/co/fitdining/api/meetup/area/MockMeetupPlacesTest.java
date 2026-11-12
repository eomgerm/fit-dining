package kr.co.fitdining.api.meetup.area;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupPoint;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MockMeetupPlacesTest {

	@Test
	@DisplayName("지역목록_Mock장소의역과주소의동표기로_만든다")
	void areas_fromMockPlaces() {
		PlaceDetailResponse yeoksam = place(Station.YEOKSAM, "서울 강남구 테헤란로 1");
		PlaceDetailResponse seocho = place(Station.SEOLLEUNG, "서울 서초구 서초대로77길 27 (서초동)");
		PlaceDetailResponse noAddress = place(Station.SEOLLEUNG, null);
		PlaceSearchEngine engine = mock(PlaceSearchEngine.class);
		when(engine.placeIds()).thenReturn(List.of(1L, 2L, 3L));
		when(engine.findPlace(1L)).thenReturn(Optional.of(yeoksam));
		when(engine.findPlace(2L)).thenReturn(Optional.of(seocho));
		when(engine.findPlace(3L)).thenReturn(Optional.of(noAddress));

		assertThat(new MockMeetupPlaces(engine).areas()).containsExactly(
				new MeetupArea(AreaKind.STATION, "선릉"),
				new MeetupArea(AreaKind.STATION, "역삼"),
				new MeetupArea(AreaKind.DONG, "서초동"));
	}

	@Test
	@DisplayName("반경안장소_지점에서반경안의수와가장많은동을준다")
	void around_countsWithinRadius() {
		List<PlaceDetailResponse> found = List.of(
				located(1, 37.5000, 127.0000, "서울 서초구 서초대로 1 (서초동)"),
				located(2, 37.5010, 127.0000, "서울 서초구 서초대로 2 (서초동)"),
				located(3, 37.5000, 127.0010, "서울 서초구 반포대로 3 (반포동)"),
				located(4, 37.6000, 127.0000, "서울 서초구 서초대로 4 (서초동)"));
		PlaceSearchEngine engine = mock(PlaceSearchEngine.class);
		when(engine.placeIds()).thenReturn(List.of(1L, 2L, 3L, 4L));
		for (PlaceDetailResponse place : found) {
			when(engine.findPlace(place.place().id())).thenReturn(Optional.of(place));
		}
		MockMeetupPlaces places = new MockMeetupPlaces(engine);

		assertThat(places.around(new MeetupPoint(37.5, 127.0, 500)))
				.isEqualTo(new MeetupPlaces.PlacesAround(3, "서초동"));
		assertThat(places.around(new MeetupPoint(37.7, 127.0, 500)))
				.isEqualTo(new MeetupPlaces.PlacesAround(0, null));
	}

	private static PlaceDetailResponse located(long id, double lat, double lng, String address) {
		PlaceSummary summary = mock(PlaceSummary.class);
		when(summary.id()).thenReturn(id);
		when(summary.lat()).thenReturn(lat);
		when(summary.lng()).thenReturn(lng);
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(detail.place()).thenReturn(summary);
		when(detail.address()).thenReturn(address);
		return detail;
	}

	private static PlaceDetailResponse place(Station station, String address) {
		PlaceSummary summary = mock(PlaceSummary.class);
		when(summary.station()).thenReturn(station);
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(detail.place()).thenReturn(summary);
		when(detail.address()).thenReturn(address);
		return detail;
	}

}
