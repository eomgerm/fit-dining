package kr.co.fitdining.api.meetup.area;

import java.util.List;
import java.util.stream.Stream;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.catalog.PlaceAreaNames;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** DB 모드의 장소 데이터. 장소 카탈로그를 읽는다. */
@Component
@ConditionalOnCatalogMode
@RequiredArgsConstructor
class CatalogMeetupPlaces implements MeetupPlaces {

	private final PlaceCatalog catalog;

	@Override
	public List<MeetupArea> areas() {
		PlaceAreaNames names = catalog.areaNames();
		return Stream.concat(
				names.stations().stream().map(station -> new MeetupArea(AreaKind.STATION, station.shortName())),
				names.dongs().stream().map(dong -> new MeetupArea(AreaKind.DONG, dong))).toList();
	}

}
