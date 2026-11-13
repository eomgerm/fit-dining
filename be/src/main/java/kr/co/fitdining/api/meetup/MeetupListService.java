package kr.co.fitdining.api.meetup;

import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.dto.MeetupListResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 내 모임(AC-75, D-37). 로그인한 회원이 만든 모임과 회원 프로필로 참여한 모임이다. */
@Service
public class MeetupListService {

	private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;
	private final MeetupPlaces places;
	private final AuthUserRepository users;

	public MeetupListService(MeetupRepository meetups, MeetupProfileRepository profiles, MeetupPlaces places,
			AuthUserRepository users) {
		this.meetups = meetups;
		this.profiles = profiles;
		this.places = places;
		this.users = users;
	}

	/**
	 * 최근에 만든 {@link MeetupLimits#MY_MEETUPS_MAX}개까지 읽어, 진행 중인 모임을 앞에 최근에 만든 순서로, 끝난
	 * 모임을 뒤에 최근에 정한 순서로 둔다.
	 *
	 * @throws AuthFailure 탈퇴한 회원일 때(401)
	 */
	@Transactional(readOnly = true)
	public MeetupListResponse mine(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		List<Meetup> found = meetups.findMine(userId, PageRequest.of(0, MeetupLimits.MY_MEETUPS_MAX));
		if (found.isEmpty()) {
			return new MeetupListResponse(List.of());
		}
		Map<Long, Long> counts = profiles.countByMeetupIds(found.stream().map(Meetup::getMeetupId).toList())
				.stream().collect(Collectors.toMap(row -> (Long) row[0], row -> (Long) row[1]));
		Map<Long, PlaceDetailResponse> decided = places.details(found.stream()
				.map(Meetup::getDecidedPlaceId).filter(id -> id != null).distinct().toList());
		List<MeetupListResponse.Item> items = found.stream()
				.sorted(Comparator.comparing((Meetup meetup) -> meetup.getPhase() == MeetupPhase.DECIDED)
						.thenComparing(MeetupListService::decidedFirst)
						.thenComparing(Meetup::getMeetupId, Comparator.reverseOrder()))
				.map(meetup -> item(meetup, userId, counts, decided))
				.toList();
		return new MeetupListResponse(items);
	}

	/** 끝난 모임끼리는 최근에 정한 것이 앞이다. 진행 중인 모임은 모두 같은 값이라 만든 순서만 본다. */
	private static long decidedFirst(Meetup meetup) {
		return meetup.getPhase() == MeetupPhase.DECIDED && meetup.getDecidedAt() != null
				? -meetup.getDecidedAt().toEpochMilli()
				: 0;
	}

	private static MeetupListResponse.Item item(Meetup meetup, String userId, Map<Long, Long> counts,
			Map<Long, PlaceDetailResponse> decided) {
		PlaceDetailResponse place = meetup.getDecidedPlaceId() == null ? null : decided.get(meetup.getDecidedPlaceId());
		return new MeetupListResponse.Item(meetup.getCode(),
				meetup.hostedBy(userId) ? MeetupRole.HOST : MeetupRole.PARTICIPANT, meetup.getPhase(),
				new MeetupSnapshot.Area(meetup.getAreaKind(), meetup.getAreaName(), meetup.getPointLat(),
						meetup.getPointLng(), meetup.getRadiusM()),
				meetup.getCategory(), meetup.getMeetDate(),
				meetup.getMeetTime() == null ? null : meetup.getMeetTime().format(HH_MM), meetup.getHeadcount(),
				counts.getOrDefault(meetup.getMeetupId(), 0L).intValue(),
				meetup.getPhase() == MeetupPhase.DECIDED && place != null ? place.place().name() : null);
	}

}
