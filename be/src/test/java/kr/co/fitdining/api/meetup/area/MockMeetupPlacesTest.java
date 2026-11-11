package kr.co.fitdining.api.meetup.area;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.AreaKind;
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

	private static PlaceDetailResponse place(Station station, String address) {
		PlaceSummary summary = mock(PlaceSummary.class);
		when(summary.station()).thenReturn(station);
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(detail.place()).thenReturn(summary);
		when(detail.address()).thenReturn(address);
		return detail;
	}

}
