package kr.co.fitdining.api.meetup.area;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.catalog.PlaceAreaNames;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
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

	/** 결과를 내는 AI 추천기는 추천 연동 단계에서 붙어, 그때까지는 장소마다 상세를 읽는다. */
	@Override
	public Map<Long, PlaceDetailResponse> details(Collection<Long> ids) {
		Map<Long, PlaceDetailResponse> found = new LinkedHashMap<>();
		for (Long id : ids) {
			catalog.findPlace(id).ifPresent(detail -> found.put(id, detail));
		}
		return found;
	}

}
