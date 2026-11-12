package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.domain.MeetupCodes;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupPoint;
import kr.co.fitdining.api.meetup.dto.MeetupResult;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.exception.MeetupResultNotFoundException;
import kr.co.fitdining.api.meetup.recommend.MeetupRanking;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupCalculation;
import kr.co.fitdining.api.meetup.store.MeetupCalculationRepository;
import kr.co.fitdining.api.meetup.store.MeetupProfile;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import kr.co.fitdining.api.place.catalog.OpenStatusCalculator;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 추천 결과(AC-19, AC-20). 순위와 잘 맞는 사람 표시는 저장한 점수로 줄 때마다 정하고({@link MeetupRanking}), 카드의
 * 영업 상태·대표 메뉴·시설·거리는 장소 데이터에서 읽어 붙인다(D-9).
 */
@Service
public class MeetupResultService {

	private static final String GROUP_FACILITY = "단체 이용 가능";
	private static final String RESERVATION_FACILITY = "예약";

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupCalculationRepository calculations;
	private final MeetupPlaces places;
	private final Clock clock;

	public MeetupResultService(MeetupRepository meetups, MeetupProfileRepository profiles,
			MeetupCalculationRepository calculations, MeetupPlaces places, Optional<Clock> clock) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.calculations = calculations;
		this.places = places;
		this.clock = clock.orElseGet(() -> Clock.system(MeetupLimits.SEOUL));
	}

	/**
	 * @throws MeetupNotFoundException 없는 코드일 때
	 * @throws MeetupResultNotFoundException 아직 성공한 계산이 없을 때
	 */
	@Transactional(readOnly = true)
	public MeetupResult result(String code) {
		if (!MeetupCodes.wellFormed(code)) {
			throw new MeetupNotFoundException();
		}
		Meetup meetup = meetups.findByCode(code).orElseThrow(MeetupNotFoundException::new);
		MeetupCalculation calculation = calculations
				.findFirstByMeetupIdAndStateOrderByCalcIdDesc(meetup.getMeetupId(), CalculationState.SUCCEEDED)
				.orElseThrow(MeetupResultNotFoundException::new);
		List<Long> current = profiles.findByMeetupIdOrderByProfileId(meetup.getMeetupId()).stream()
				.map(MeetupProfile::getProfileId).toList();
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(
				Objects.requireNonNullElse(calculation.getResult(), List.of()), current);
		Map<Long, PlaceDetailResponse> details = places.details(
				ranked.stream().map(item -> item.place().placeId()).toList());
		LocalDateTime at = openStatusAt(meetup);
		MeetupPoint point = meetup.point();
		List<MeetupResult.Item> items = new ArrayList<>();
		for (MeetupRanking.Ranked item : ranked) {
			PlaceDetailResponse detail = details.get(item.place().placeId());
			if (detail != null) {
				items.add(item(items.size() + 1, item, detail, at, point));
			}
		}
		return new MeetupResult(calculation.getCalcId(), calculation.getFinishedAt(), calculation.getTasteCount(),
				Objects.requireNonNullElse(calculation.getApplied(), MeetupRecommendation.Applied.NONE), items,
				emptyReason(calculation.getEmptyReason(), current));
	}

	private static MeetupResult.Item item(int rank, MeetupRanking.Ranked ranked, PlaceDetailResponse detail,
			LocalDateTime at, MeetupPoint point) {
		MeetupRecommendation.Place place = ranked.place();
		return new MeetupResult.Item(rank, detail.place(), openStatus(detail, at), place.score(), ranked.group(),
				ranked.fit(), place.reasons() == null ? List.of()
						: place.reasons().stream().limit(MeetupLimits.REASONS_MAX).toList(),
				place.caution(), menu(detail), facilities(detail), distance(detail, point));
	}

	/** 모임 날짜와 시각이 모두 있으면 그 시각, 아니면 지금(KST)이다(AC-20). */
	private LocalDateTime openStatusAt(Meetup meetup) {
		if (meetup.getMeetDate() != null && meetup.getMeetTime() != null) {
			return LocalDateTime.of(meetup.getMeetDate(), meetup.getMeetTime());
		}
		return clock.instant().atZone(MeetupLimits.SEOUL).toLocalDateTime();
	}

	private static OpenStatus openStatus(PlaceDetailResponse detail, LocalDateTime at) {
		if (detail.hours() == null || detail.hours().isEmpty()) {
			return null;
		}
		OpenStatus status = OpenStatusCalculator.openStatus(detail.hours(), at);
		return status == OpenStatus.UNKNOWN ? null : status;
	}

	/** 대표 메뉴가 있으면 그것, 없으면 첫 메뉴다. */
	private static MeetupResult.Menu menu(PlaceDetailResponse detail) {
		if (detail.menus() == null) {
			return null;
		}
		return detail.menus().stream().filter(menu -> Boolean.TRUE.equals(menu.representative())).findFirst()
				.or(() -> detail.menus().stream().findFirst())
				.filter(menu -> menu.name() != null)
				.map(menu -> new MeetupResult.Menu(menu.name(), menu.price())).orElse(null);
	}

	private static MeetupResult.Facilities facilities(PlaceDetailResponse detail) {
		List<String> facilities = detail.facilities() == null ? List.of() : detail.facilities();
		Boolean group = facilities.contains(GROUP_FACILITY) ? Boolean.TRUE : null;
		Boolean reservation = facilities.contains(RESERVATION_FACILITY) ? Boolean.TRUE : null;
		return group == null && reservation == null ? null : new MeetupResult.Facilities(group, reservation);
	}

	/** 역·동 모임은 도보 시간이 가장 짧은 역이고, 지점 모임은 지점에서 직선거리(m)다. 걸리는 시간은 없다(AC-59). */
	static MeetupResult.Distance distance(PlaceDetailResponse detail, MeetupPoint point) {
		if (point != null) {
			Double lat = detail.place().lat();
			Double lng = detail.place().lng();
			return lat == null || lng == null ? null
					: new MeetupResult.Distance(null, null, (int) Math.round(point.metersTo(lat, lng)));
		}
		if (detail.subways() == null) {
			return null;
		}
		return detail.subways().stream()
				.filter(subway -> subway.station() != null && subway.walkMinutes() != null)
				.min(Comparator.comparing(PlaceDetailResponse.Subway::walkMinutes))
				.map(subway -> new MeetupResult.Distance(subway.station(), subway.walkMinutes(), null)).orElse(null);
	}

	private static MeetupResult.EmptyReason emptyReason(MeetupRecommendation.EmptyReason reason,
			List<Long> current) {
		if (reason == null) {
			return null;
		}
		List<Long> profileIds = reason.profileIds() == null ? List.of()
				: reason.profileIds().stream().filter(current::contains).toList();
		return new MeetupResult.EmptyReason(reason.cause(), reason.suggestion(),
				profileIds.isEmpty() ? null : profileIds);
	}

}
