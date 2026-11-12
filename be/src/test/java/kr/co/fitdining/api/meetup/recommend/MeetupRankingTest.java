package kr.co.fitdining.api.meetup.recommend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.LongStream;
import kr.co.fitdining.api.meetup.domain.FitKind;
import kr.co.fitdining.api.meetup.domain.ResultGroup;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.MemberScore;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation.Place;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 순위 규칙과 잘 맞는 사람 표시(AC-19, AC-20, D-18) */
class MeetupRankingTest {

	private static final List<Long> TWO = List.of(1L, 2L);

	private static Place place(long id, Integer score, MemberScore... members) {
		return new Place(id, score, List.of(), null, List.of(members));
	}

	private static MemberScore member(long profileId, Integer score) {
		return new MemberScore(profileId, score, false, null);
	}

	private static List<Long> order(List<MeetupRanking.Ranked> ranked) {
		return ranked.stream().map(item -> item.place().placeId()).toList();
	}

	@Test
	@DisplayName("순위_덜맞는사람이있는곳은_점수가높아도뒤묶음이다")
	void rank_misfitGroupAfterAllFit() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, 95, member(1, 99), member(2, 40)),
				place(11, 70, member(1, 70), member(2, 70))), TWO);

		assertThat(order(ranked)).containsExactly(11L, 10L);
		assertThat(ranked).extracting(MeetupRanking.Ranked::group)
				.containsExactly(ResultGroup.ALL_FIT, ResultGroup.SOME_MISFIT);
	}

	@Test
	@DisplayName("순위_모임점수가같으면_가장낮은참여자점수가높은곳이앞이다")
	void rank_sameScore_higherLowestFirst() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, 80, member(1, 90), member(2, 60)),
				place(11, 80, member(1, 75), member(2, 75)),
				place(12, 85, member(1, 85), member(2, 85))), TWO);

		assertThat(order(ranked)).containsExactly(12L, 11L, 10L);
	}

	@Test
	@DisplayName("순위_이웃한두곳이3점이내로붙어있으면_가장낮은참여자점수가높은곳이앞이다")
	void rank_closeScores_higherLowestFirst() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, 90, member(1, 95), member(2, 55)),
				place(11, 88, member(1, 80), member(2, 80)),
				place(12, 80, member(1, 90), member(2, 90))), TWO);

		// 12는 11과 8점 떨어져 있어 자리를 바꾸지 않는다
		assertThat(order(ranked)).containsExactly(11L, 10L, 12L);
	}

	@Test
	@DisplayName("순위_3점보다떨어져있으면_모임점수순서다")
	void rank_scoresApart_scoreOrder() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, 90, member(1, 95), member(2, 55)),
				place(11, 86, member(1, 80), member(2, 80))), TWO);

		assertThat(order(ranked)).containsExactly(10L, 11L);
	}

	@Test
	@DisplayName("순위_참여자점수가하나도없는곳은_붙어있어도자리를바꾸지않는다")
	void rank_closeScores_noMemberScores_kept() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, 90, member(1, 60)),
				place(11, 89, member(1, null))), List.of(1L));

		assertThat(order(ranked)).containsExactly(10L, 11L);
	}

	@Test
	@DisplayName("순위_다른곳에는모임점수가있는데없는곳은_묶음과상관없이맨뒤의따로된묶음이다")
	void rank_unscored_lastSeparateGroup() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, null, member(1, null)),
				place(11, 70, member(1, 40)),
				place(13, null, member(1, 30)),
				place(12, 80, member(1, 90))), List.of(1L));

		assertThat(order(ranked)).containsExactly(12L, 11L, 10L, 13L);
		assertThat(ranked).extracting(MeetupRanking.Ranked::group).containsExactly(ResultGroup.ALL_FIT,
				ResultGroup.SOME_MISFIT, ResultGroup.UNSCORED, ResultGroup.UNSCORED);
		assertThat(ranked.get(3).fit().kind()).isEqualTo(FitKind.MISFIT);
	}

	@Test
	@DisplayName("순위_모임점수가없으면_묶음안에서추천기의순서를지킨다")
	void rank_noScore_keepsRecommenderOrder() {
		List<MeetupRanking.Ranked> ranked = MeetupRanking.rank(List.of(
				place(10, null, member(1, null)),
				place(11, null, member(1, 30)),
				place(12, null, member(1, null))), List.of(1L));

		assertThat(order(ranked)).containsExactly(10L, 12L, 11L);
		assertThat(ranked).extracting(MeetupRanking.Ranked::group).doesNotContain(ResultGroup.UNSCORED);
	}

	@Test
	@DisplayName("판정_점수가없는참여자는_잘맞는사람이다")
	void judge_noScore_fits() {
		MeetupRanking.Fit fit = MeetupRanking.rank(List.of(place(10, 70, member(1, null), member(2, 80))), TWO)
				.getFirst().fit();

		assertThat(fit).isEqualTo(new MeetupRanking.Fit(FitKind.ALL, TWO, null, null));
	}

	@Test
	@DisplayName("판정_덜맞는사람과_그사람이원한메뉴를준다")
	void judge_misfit_withMissedMenu() {
		MeetupRanking.Fit fit = MeetupRanking.rank(List.of(place(10, 70, member(1, 80),
				new MemberScore(2, 49, false, "곱창"), new MemberScore(3, 90, false, "마라탕"))), List.of(1L, 2L, 3L))
				.getFirst().fit();

		assertThat(fit).isEqualTo(new MeetupRanking.Fit(FitKind.MISFIT, List.of(1L, 3L), List.of(2L),
				List.of(new MeetupRanking.MissedMenu(2, "곱창"))));
	}

	@Test
	@DisplayName("판정_50점은_덜맞는사람이아니다")
	void judge_boundary_fifty() {
		assertThat(MeetupRanking.rank(List.of(place(10, 70, member(1, 50))), List.of(1L)).getFirst().group())
				.isEqualTo(ResultGroup.ALL_FIT);
	}

	@Test
	@DisplayName("판정_근거없는항목이있으면_대체로다")
	void judge_unverified_mostly() {
		MeetupRanking.Fit fit = MeetupRanking.rank(List.of(place(10, 70, member(1, 80),
				new MemberScore(2, 70, true, null))), TWO).getFirst().fit();

		assertThat(fit.kind()).isEqualTo(FitKind.MOSTLY);
	}

	@Test
	@DisplayName("판정_계산뒤에들어온사람이있으면_반영된수다")
	void judge_lateJoiner_count() {
		MeetupRanking.Fit fit = MeetupRanking.rank(List.of(place(10, 70, member(1, 80), member(2, 70))),
				List.of(1L, 2L, 3L)).getFirst().fit();

		assertThat(fit).isEqualTo(new MeetupRanking.Fit(FitKind.COUNT, TWO, null, null));
	}

	@Test
	@DisplayName("판정_계산뒤에지운프로필은_빼고판정한다")
	void judge_removedProfile_ignored() {
		MeetupRanking.Ranked ranked = MeetupRanking.rank(List.of(place(10, 70, member(1, 80), member(2, 10))),
				List.of(1L)).getFirst();

		assertThat(ranked.group()).isEqualTo(ResultGroup.ALL_FIT);
		assertThat(ranked.fit()).isEqualTo(new MeetupRanking.Fit(FitKind.ALL, List.of(1L), null, null));
	}

	@Test
	@DisplayName("순위_20곳까지만준다")
	void rank_limitsToTwenty() {
		List<Place> places = LongStream.rangeClosed(1, 25).mapToObj(id -> place(id, 50, member(1, 60))).toList();

		assertThat(MeetupRanking.rank(places, List.of(1L))).hasSize(20);
	}

}
