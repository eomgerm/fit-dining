package kr.co.fitdining.api.meetup.recommend;

import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import kr.co.fitdining.api.meetup.domain.FitKind;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.ResultGroup;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.MemberScore;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.Place;

/**
 * 순위 규칙(D-18, AC-19, AC-20). 저장한 점수로 결과를 줄 때마다 정하고, 계산 뒤에 지운 프로필은 빼고 판정한다.
 * 덜 맞는 사람이 없는 묶음이 앞이고, 묶음 안은 모임 점수 내림차순, 같으면 가장 낮은 참여자 점수가 높은 곳이 앞이다.
 * 모임 점수가 없으면 묶음 안에서 추천기의 순서를 지킨다.
 */
public final class MeetupRanking {

	private static final int NO_SCORE = 100;

	private MeetupRanking() {
	}

	/**
	 * @param lowestScore 지금 있는 프로필의 가장 낮은 참여자 점수. 점수가 하나도 없으면 100이다.
	 */
	public record Ranked(Place place, ResultGroup group, Fit fit, int lowestScore) {
	}

	/**
	 * @param fitProfileIds 잘 맞는 사람. 점수가 없는 사람도 들어간다.
	 * @param misfitProfileIds 덜 맞는 사람. 없으면 null이다.
	 * @param missedMenus 덜 맞는 사람이 원했지만 팔지 않는 메뉴. 없으면 null이다.
	 */
	public record Fit(FitKind kind, List<Long> fitProfileIds, List<Long> misfitProfileIds,
			List<MissedMenu> missedMenus) {
	}

	public record MissedMenu(long profileId, String menu) {
	}

	/**
	 * @param places 추천기가 준 순서의 장소
	 * @param currentProfileIds 지금 모임에 있는 프로필
	 * @return 정한 순서의 장소. {@link MeetupLimits#RESULT_MAX}곳까지다.
	 */
	public static List<Ranked> rank(List<Place> places, Collection<Long> currentProfileIds) {
		Set<Long> current = Set.copyOf(currentProfileIds);
		List<Ranked> judged = places.stream().map(place -> judge(place, current)).toList();
		Comparator<Ranked> order = Comparator.comparing(Ranked::group);
		if (places.stream().allMatch(place -> place.score() != null)) {
			order = order.thenComparing(ranked -> ranked.place().score(), Comparator.reverseOrder())
					.thenComparing(Ranked::lowestScore, Comparator.reverseOrder());
		}
		return judged.stream().sorted(order).limit(MeetupLimits.RESULT_MAX).toList();
	}

	private static Ranked judge(Place place, Set<Long> current) {
		List<MemberScore> live = Objects.requireNonNullElse(place.members(), List.<MemberScore>of()).stream()
				.filter(member -> current.contains(member.profileId())).toList();
		List<MemberScore> misfits = live.stream().filter(MeetupRanking::misfit).toList();
		List<Long> fitIds = live.stream().filter(member -> !misfit(member)).map(MemberScore::profileId).toList();
		List<MissedMenu> missed = misfits.stream().filter(member -> member.missedMenu() != null)
				.map(member -> new MissedMenu(member.profileId(), member.missedMenu())).toList();
		int lowest = live.stream().map(MemberScore::score).filter(Objects::nonNull).mapToInt(Integer::intValue)
				.min().orElse(NO_SCORE);
		Fit fit = new Fit(kind(live, misfits, current), fitIds,
				misfits.isEmpty() ? null : misfits.stream().map(MemberScore::profileId).toList(),
				missed.isEmpty() ? null : missed);
		return new Ranked(place, misfits.isEmpty() ? ResultGroup.ALL_FIT : ResultGroup.SOME_MISFIT, fit, lowest);
	}

	private static FitKind kind(List<MemberScore> live, List<MemberScore> misfits, Set<Long> current) {
		if (!misfits.isEmpty()) {
			return FitKind.MISFIT;
		}
		if (live.stream().anyMatch(MemberScore::unverified)) {
			return FitKind.MOSTLY;
		}
		return live.size() < current.size() ? FitKind.COUNT : FitKind.ALL;
	}

	private static boolean misfit(MemberScore member) {
		return member.score() != null && member.score() < MeetupLimits.MISFIT_SCORE;
	}

}
