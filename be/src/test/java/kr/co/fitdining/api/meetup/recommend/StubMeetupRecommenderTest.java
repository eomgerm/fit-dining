package kr.co.fitdining.api.meetup.recommend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.engine.MockPlaceSearchEngine;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** 장소 Mock 모드의 대신 쓰는 추천기(AC-21). Mock 장소 파일을 그대로 읽는다. */
class StubMeetupRecommenderTest {

	private static final PlaceSearchEngine ENGINE = new MockPlaceSearchEngine(JsonMapper.builder().build(),
			Optional.empty());
	private static final StubMeetupRecommender RECOMMENDER = new StubMeetupRecommender(ENGINE);
	private static final Taste LIKES_KOREAN = new Taste(Mood.QUIET, List.of(FoodType.KOREAN), null, true, null,
			"곱창, 마라탕");

	private static MeetupRecommender.Input input(MeetupCategory category, String description,
			MeetupRecommender.Member... members) {
		return new MeetupRecommender.Input(AreaKind.STATION, "선릉", category, null, null, description,
				List.of(members));
	}

	@Test
	@DisplayName("추천_지역과업종안의장소만_같은입력이면같은결과다")
	void recommend_filtersAreaAndCategory_deterministic() {
		MeetupRecommender.Input input = input(MeetupCategory.RESTAURANT, null,
				new MeetupRecommender.Member(1, null, LIKES_KOREAN),
				new MeetupRecommender.Member(2, "user", Taste.EMPTY));

		MeetupRecommendation first = RECOMMENDER.recommend(input);

		assertThat(first).isEqualTo(RECOMMENDER.recommend(input));
		assertThat(first.places()).isNotEmpty();
		assertThat(first.places()).allSatisfy(place -> {
			PlaceDetailResponse detail = ENGINE.findPlace(place.placeId()).orElseThrow();
			assertThat(detail.place().station()).isEqualTo(PlaceSummary.Station.SEOLLEUNG);
			assertThat(detail.place().categoryGroup()).isEqualTo(PlaceSummary.CategoryGroup.RESTAURANT);
			assertThat(place.members()).extracting(MeetupRecommendation.MemberScore::profileId)
					.containsExactly(1L, 2L);
			assertThat(place.members().get(1).score()).isNull();
			assertThat(place.reasons()).hasSizeLessThanOrEqualTo(2);
		});
		assertThat(first.places()).extracting(MeetupRecommendation.Place::score).isSortedAccordingTo(
				java.util.Comparator.reverseOrder());
		assertThat(first.applied()).isEqualTo(new MeetupRecommendation.Applied(Mood.QUIET, List.of(FoodType.KOREAN),
				null, true, null, List.of("곱창", "마라탕")));
		assertThat(first.emptyReason()).isNull();
	}

	@Test
	@DisplayName("추천_상관없음이면_모든업종이다")
	void recommend_any_allCategories() {
		MeetupRecommendation recommendation = RECOMMENDER.recommend(input(MeetupCategory.ANY, "회식",
				new MeetupRecommender.Member(1, null, Taste.EMPTY)));

		assertThat(recommendation.places()).extracting(place -> ENGINE.findPlace(place.placeId()).orElseThrow()
				.place().categoryGroup()).contains(PlaceSummary.CategoryGroup.CAFE, PlaceSummary.CategoryGroup.BAR);
	}

	@Test
	@DisplayName("추천_점수를매길조건이없으면_모임점수가없다")
	void recommend_noConditions_noScore() {
		MeetupRecommendation recommendation = RECOMMENDER.recommend(input(MeetupCategory.RESTAURANT, null,
				new MeetupRecommender.Member(1, null, Taste.EMPTY)));

		assertThat(recommendation.applied().blank()).isTrue();
		assertThat(recommendation.places()).isNotEmpty().allSatisfy(place -> assertThat(place.score()).isNull());
	}

	@Test
	@DisplayName("추천_원한메뉴를팔지않으면_놓친메뉴다")
	void recommend_missedMenu() {
		MeetupRecommendation recommendation = RECOMMENDER.recommend(input(MeetupCategory.RESTAURANT, null,
				new MeetupRecommender.Member(1, null, new Taste(null, null, null, null, null, "없는메뉴이름"))));

		assertThat(recommendation.places()).allSatisfy(
				place -> assertThat(place.members().getFirst().missedMenu()).isEqualTo("없는메뉴이름"));
	}

	@Test
	@DisplayName("추천이유_받침에따라_이라는과라는을붙인다")
	void reason_particleByBatchim() {
		assertThat(StubMeetupRecommender.endsWithBatchim("단체석")).isTrue();
		assertThat(StubMeetupRecommender.endsWithBatchim("가성비")).isFalse();
		assertThat(StubMeetupRecommender.endsWithBatchim("wifi")).isFalse();
	}

	@Test
	@DisplayName("추천_장소가없는지역이면_원인을준다")
	void recommend_emptyArea_reason() {
		MeetupRecommendation recommendation = RECOMMENDER.recommend(new MeetupRecommender.Input(AreaKind.STATION,
				"없는역", MeetupCategory.ANY, null, null, null, List.of()));

		assertThat(recommendation.places()).isEmpty();
		assertThat(recommendation.emptyReason()).isNotNull();
	}

}
