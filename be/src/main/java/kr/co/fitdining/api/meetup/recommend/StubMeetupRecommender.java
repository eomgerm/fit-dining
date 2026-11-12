package kr.co.fitdining.api.meetup.recommend;

import java.util.Arrays;
import java.util.Comparator;
import java.util.IntSummaryStatistics;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import kr.co.fitdining.api.meetup.area.MeetupArea;
import kr.co.fitdining.api.meetup.area.MockPlaceAreas;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.Applied;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.MemberScore;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.Place;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.stereotype.Component;

/**
 * 장소 Mock 모드의 대신 쓰는 추천기(D-11, AC-21). AI를 부르지 않고 지역과 업종 안의 Mock 장소에 정해진 규칙으로 점수를
 * 매긴다. 같은 입력이면 같은 결과다. 화면의 표시를 모두 볼 수 있게 참여자 점수는 장소와 프로필 번호로 정해 덜 맞는
 * 사람도 나오고, 추천 이유는 장소의 태그로 만든다.
 */
@Component
@ConditionalOnBooleanProperty("place.mock.enabled")
class StubMeetupRecommender implements MeetupRecommender {

	private static final String MENU_SEPARATORS = "[,，、/]";

	private final List<PlaceDetailResponse> places;

	StubMeetupRecommender(PlaceSearchEngine engine) {
		this.places = engine.placeIds().stream().map(engine::findPlace).flatMap(Optional::stream).toList();
	}

	@Override
	public MeetupRecommendation recommend(Input input) {
		MeetupArea area = new MeetupArea(input.areaKind(), input.areaName());
		Applied applied = applied(input.members());
		boolean scorable = input.description() != null || !applied.blank();
		List<Place> found = places.stream()
				.filter(place -> MockPlaceAreas.contains(area, input.point(), place))
				.filter(place -> sells(input.category(), place))
				.map(place -> place(place, input.members(), scorable))
				.sorted(Comparator.comparing(Place::score, Comparator.nullsLast(Comparator.reverseOrder())))
				.limit(MeetupLimits.RESULT_MAX).toList();
		return new MeetupRecommendation(found, applied, found.isEmpty()
				? new MeetupRecommendation.EmptyReason("조건에 맞는 곳이 없어요.", "지역이나 업종을 바꿔 보세요.", null)
				: null);
	}

	/** 쉼표 따위로 나눈 먹고 싶은 메뉴 */
	static List<String> menus(String wantMenu) {
		if (wantMenu == null) {
			return List.of();
		}
		return Arrays.stream(wantMenu.split(MENU_SEPARATORS)).map(String::strip).filter(menu -> !menu.isEmpty())
				.distinct().toList();
	}

	private static boolean sells(MeetupCategory category, PlaceDetailResponse place) {
		return category == MeetupCategory.ANY || place.place().categoryGroup().name().equals(category.name());
	}

	private static Place place(PlaceDetailResponse detail, List<Member> members, boolean scorable) {
		long placeId = detail.place().id();
		List<MemberScore> scores = members.stream().map(member -> new MemberScore(member.profileId(),
				memberScore(placeId, member), false, missedMenu(detail, member))).toList();
		return new Place(placeId, scorable ? groupScore(placeId, scores) : null, reasons(detail), null, scores);
	}

	/** 답이 없는 참여자는 점수가 없다. 나머지는 45~94점이라 덜 맞는 사람이 가끔 나온다. */
	private static Integer memberScore(long placeId, Member member) {
		return member.taste().isEmpty() ? null : 45 + (int) Math.floorMod(placeId * 37 + member.profileId() * 11, 50L);
	}

	private static int groupScore(long placeId, List<MemberScore> scores) {
		IntSummaryStatistics stats = scores.stream().map(MemberScore::score).filter(Objects::nonNull)
				.mapToInt(Integer::intValue).summaryStatistics();
		return stats.getCount() == 0 ? 60 + (int) Math.floorMod(placeId * 13, 30L) : (int) Math.round(stats.getAverage());
	}

	private static String missedMenu(PlaceDetailResponse detail, Member member) {
		List<String> wanted = menus(member.taste().wantMenu());
		if (wanted.isEmpty()) {
			return null;
		}
		List<String> sold = detail.menus() == null ? List.of()
				: detail.menus().stream().map(PlaceDetailResponse.Menu::name).filter(Objects::nonNull).toList();
		boolean sells = wanted.stream().anyMatch(menu -> sold.stream().anyMatch(name -> name.contains(menu)));
		return sells ? null : wanted.getFirst();
	}

	private static List<PlaceCard.Reason> reasons(PlaceDetailResponse detail) {
		List<String> tags = detail.tags() == null ? List.of() : detail.tags();
		return tags.stream().limit(MeetupLimits.REASONS_MAX)
				.map(tag -> new PlaceCard.Reason("\"" + tag + "\"" + (endsWithBatchim(tag) ? "이라는" : "라는") + " 평이 많아요",
						List.of(new PlaceCard.ReasonTag(PlaceCard.EvidenceSource.REQUEST, tag)), null, null))
				.toList();
	}

	/** 마지막 글자가 받침 있는 한글인지 */
	static boolean endsWithBatchim(String word) {
		char last = word.charAt(word.length() - 1);
		return last >= '가' && last <= '힣' && (last - '가') % 28 != 0;
	}

	private static Applied applied(List<Member> members) {
		List<Taste> tastes = members.stream().map(Member::taste).toList();
		Set<Mood> moods = tastes.stream().map(Taste::mood).filter(mood -> mood != null && mood != Mood.ANY)
				.collect(Collectors.toSet());
		List<String> wantMenus = tastes.stream().flatMap(taste -> menus(taste.wantMenu()).stream()).distinct()
				.toList();
		return new Applied(moods.size() == 1 ? moods.iterator().next() : null,
				foods(tastes, Taste::likeFoods), foods(tastes, Taste::avoidFoods),
				tastes.stream().anyMatch(taste -> Boolean.TRUE.equals(taste.noSpicy())) ? Boolean.TRUE : null,
				tastes.stream().map(Taste::priceCap).filter(Objects::nonNull).min(Comparator.naturalOrder())
						.orElse(null),
				wantMenus.isEmpty() ? null : wantMenus);
	}

	private static List<FoodType> foods(List<Taste> tastes, Function<Taste, List<FoodType>> answer) {
		List<FoodType> foods = tastes.stream().map(answer).filter(Objects::nonNull).flatMap(List::stream).distinct()
				.sorted().toList();
		return foods.isEmpty() ? null : foods;
	}

}
