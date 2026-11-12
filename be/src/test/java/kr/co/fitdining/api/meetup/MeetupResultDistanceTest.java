package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import kr.co.fitdining.api.meetup.domain.MeetupPoint;
import kr.co.fitdining.api.meetup.dto.MeetupResult;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 결과 카드의 거리(AC-59) */
class MeetupResultDistanceTest {

	static PlaceDetailResponse detail(Double lat, Double lng) {
		PlaceDetailResponse detail = mock(PlaceDetailResponse.class);
		when(detail.place()).thenReturn(new PlaceSummary(1L, "가", CategoryGroup.RESTAURANT, null, lat, lng, null));
		when(detail.subways()).thenReturn(List.of(new PlaceDetailResponse.Subway("선릉", "2", "1번", 7),
				new PlaceDetailResponse.Subway("역삼", "2", null, 4)));
		return detail;
	}

	@Test
	@DisplayName("거리_지점모임이면_지점에서직선거리이고걸리는시간이없다")
	void distance_point_meters() {
		MeetupResult.Distance distance = MeetupResultService.distance(detail(37.501, 127.0),
				new MeetupPoint(37.5, 127.0, 1000));

		assertThat(distance).isEqualTo(new MeetupResult.Distance(null, null, 111));
	}

	@Test
	@DisplayName("거리_역동모임이면_도보시간이가장짧은역이다")
	void distance_station_shortestWalk() {
		assertThat(MeetupResultService.distance(detail(37.501, 127.0), null))
				.isEqualTo(new MeetupResult.Distance("역삼", 4, null));
	}

}
