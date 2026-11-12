package kr.co.fitdining.api.meetup.recommend;

import java.util.ArrayList;
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
 * 이웃한 두 곳의 모임 점수가 {@link MeetupLimits#CLOSE_SCORE_GAP}점 이내로 붙어 있으면 가장 낮은 참여자 점수가 높은
 * 곳을 앞에 둔다(PRD D-42). 다른 곳에는 모임 점수가 있는데 점수가 없는 곳은 묶음과 상관없이 맨 뒤의 따로 된 묶음에
 * 둔다. 모든 곳에 모임 점수가 없으면 묶음 안에서 추천기의 순서를 지킨다.
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
		boolean anyScored = places.stream().anyMatch(place -> place.score() != null);
		// 한 묶음 안은 모두 점수가 있거나 모두 없다. 점수가 없는 묶음은 정렬해도 추천기의 순서가 남는다.
		Comparator<Ranked> order = Comparator.comparing(Ranked::group).thenComparing((a, b) -> {
			Integer first = a.place().score();
			Integer second = b.place().score();
			if (first == null || second == null) {
				return 0;
			}
			int byScore = Integer.compare(second, first);
			return byScore != 0 ? byScore : Integer.compare(b.lowestScore(), a.lowestScore());
		});
		List<Ranked> ranked = new ArrayList<>(
				places.stream().map(place -> judge(place, current, anyScored)).sorted(order).toList());
		closeNeighbors(ranked, current);
		return ranked.stream().limit(MeetupLimits.RESULT_MAX).toList();
	}

	/**
	 * 같은 묶음의 이웃한 두 곳이 점수가 붙어 있고 아래 곳의 가장 낮은 참여자 점수가 더 높으면 자리를 바꾼다. 바꿀 곳이 없을
	 * 때까지 되풀이한다. 바꿀 때마다 가장 낮은 참여자 점수의 뒤바뀐 쌍이 하나씩 줄어 끝난다. 참여자 점수가 하나도 없는
	 * 곳은 바꾸지 않는다.
	 */
	private static void closeNeighbors(List<Ranked> ranked, Set<Long> current) {
		boolean changed = true;
		while (changed) {
			changed = false;
			for (int i = 0; i + 1 < ranked.size(); i++) {
				Ranked upper = ranked.get(i);
				Ranked lower = ranked.get(i + 1);
				if (close(upper, lower) && memberScored(upper, current) && memberScored(lower, current)
						&& lower.lowestScore() > upper.lowestScore()) {
					ranked.set(i, lower);
					ranked.set(i + 1, upper);
					changed = true;
				}
			}
		}
	}

	private static boolean close(Ranked upper, Ranked lower) {
		Integer first = upper.place().score();
		Integer second = lower.place().score();
		return upper.group() == lower.group() && first != null && second != null
				&& first - second <= MeetupLimits.CLOSE_SCORE_GAP;
	}

	private static boolean memberScored(Ranked ranked, Set<Long> current) {
		return Objects.requireNonNullElse(ranked.place().members(), List.<MemberScore>of()).stream()
				.anyMatch(member -> current.contains(member.profileId()) && member.score() != null);
	}

	private static Ranked judge(Place place, Set<Long> current, boolean anyScored) {
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
		ResultGroup group = anyScored && place.score() == null ? ResultGroup.UNSCORED
				: misfits.isEmpty() ? ResultGroup.ALL_FIT : ResultGroup.SOME_MISFIT;
		return new Ranked(place, group, fit, lowest);
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
