package kr.co.fitdining.api.meetup.recommend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.domain.MeetupPoint;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.engine.AiSearchClient;
import kr.co.fitdining.api.place.engine.AiSearchClient.Reply;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

/**
 * DB 모드 추천기(AC-46, AC-48, AC-56). AI 호출 뼈대는 가짜로 두고 요청 본문, 다시 해석하는 순서, 응답 변환을 본다. 호출
 * 뼈대의 예산과 차단기는 {@code AiSearchClientTest}가 본다.
 */
class AiMeetupRecommenderTest {

	static final String DESCRIPTION = "조용한 곳";
	static final MeetupInterpretation STORED = new MeetupInterpretation(Map.of("version", 3, "text", DESCRIPTION),
			new MeetupInterpretation.Summary(false));
	static final Map<String, Object> FRESH_CONDITIONS = Map.of("version", 3, "text", DESCRIPTION, "codes",
			List.of("QUIET"));

	final AiSearchClient ai = mock(AiSearchClient.class);
	final MeetupInterpretations interpretations = mock(MeetupInterpretations.class);
	final AiMeetupRecommender recommender = new AiMeetupRecommender(new AiMeetupClient(ai), interpretations);

	static MeetupRecommender.Input input(String description, MeetupInterpretation interpretation) {
		return new MeetupRecommender.Input(7, AreaKind.STATION, "선릉", null, MeetupCategory.RESTAURANT,
				LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), description, interpretation,
				List.of(new MeetupRecommender.Member(1, "user-1", new Taste(Mood.QUIET, List.of(FoodType.KOREAN),
						null, null, null, null)),
						new MeetupRecommender.Member(2, null, new Taste(Mood.ANY, List.of(), List.of(FoodType.CHINESE),
								true, 20000, "곱창, 마라탕")),
						new MeetupRecommender.Member(3, null, Taste.EMPTY)));
	}

	static AiMeetupClient.Found found() {
		return new AiMeetupClient.Found(
				new AiMeetupClient.Applied("QUIET", List.of("KOREAN", "MEXICAN"), null, true, 20000, List.of("곱창")),
				List.of(new AiMeetupClient.Item(10L, 86,
						List.of(new MeetupRecommendation.Reason("조용해요", List.of(new MeetupRecommendation.ReasonTag(
								PlaceCard.EvidenceSource.PREFERENCE, "조용해요")), null, null)),
						"주차는 어려워요",
						List.of(new AiMeetupClient.MemberScore("1", 100, null, null),
								new AiMeetupClient.MemberScore("2", 40, true, "곱창"),
								new AiMeetupClient.MemberScore("3", null, null, null)))),
				null);
	}

	void searchReplies(Reply<AiMeetupClient.Found> first, Reply<AiMeetupClient.Found> second) {
		when(ai.post(anyString(), eq(AiMeetupClient.SEARCH_PATH), any(), eq(AiMeetupClient.Found.class), any()))
				.thenReturn(first, second);
	}

	void searchReplies(Reply<AiMeetupClient.Found> reply) {
		searchReplies(reply, reply);
	}

	void interpretReplies(Reply<AiMeetupClient.Interpreted> reply) {
		when(ai.post(anyString(), eq(AiMeetupClient.INTERPRET_PATH), any(), eq(AiMeetupClient.Interpreted.class),
				any())).thenReturn(reply);
	}

	static Reply<AiMeetupClient.Found> ok() {
		return new Reply<>(found(), 200, null);
	}

	static Reply<AiMeetupClient.Interpreted> interpreted() {
		return new Reply<>(new AiMeetupClient.Interpreted(FRESH_CONDITIONS, new AiMeetupClient.Interpreted.Summary(true)),
				200, null);
	}

	static <T> Reply<T> failed() {
		return new Reply<>(null, 0, null);
	}

	@SuppressWarnings("unchecked")
	Map<String, Object> searchBody(int call) {
		ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
		verify(ai, times(call)).post(eq("meetup search"), eq(AiMeetupClient.SEARCH_PATH), body.capture(),
				eq(AiMeetupClient.Found.class), any());
		return (Map<String, Object>) body.getAllValues().get(call - 1);
	}

	@Test
	@DisplayName("요청본문_저장한조건과지역업종날짜참여자만싣고_보이는답만담으며이름이없다")
	void body_contractFieldsOnly() {
		Map<String, Object> body = AiMeetupRecommender.body(input(DESCRIPTION, STORED), STORED);

		Map<String, Object> expected = new LinkedHashMap<>();
		expected.put("conditions", STORED.conditions());
		expected.put("area", Map.of("kind", "STATION", "name", "선릉"));
		expected.put("category", "RESTAURANT");
		expected.put("when", Map.of("date", "2026-11-14", "time", "19:00"));
		expected.put("members", List.of(
				Map.of("key", "1", "userId", "user-1", "mood", "QUIET", "likeFoods", List.of("KOREAN")),
				Map.of("key", "2", "avoidFoods", List.of("CHINESE"), "noSpicy", true, "menuPriceCapWon", 20000,
						"wantMenu", "곱창, 마라탕"),
				Map.of("key", "3")));
		assertThat(body).containsExactlyEntriesOf(expected);
	}

	@Test
	@DisplayName("요청본문_상관없음이면업종을빼고_지점이면원형반경이며_날짜만있으면시각이없다")
	void body_anyCategoryPointDateOnly() {
		MeetupRecommender.Input input = new MeetupRecommender.Input(7, AreaKind.POINT, "역삼동 근처",
				new MeetupPoint(37.5, 127.05, 1000), MeetupCategory.ANY, LocalDate.of(2026, 11, 14), null,
				null, null, List.of(new MeetupRecommender.Member(1, null, Taste.EMPTY)));

		Map<String, Object> body = AiMeetupRecommender.body(input, null);

		assertThat(body).doesNotContainKeys("conditions", "category");
		assertThat(body.get("area")).isEqualTo(Map.of("kind", "CIRCLE", "lat", 37.5, "lng", 127.05, "radiusM", 1000));
		assertThat(body.get("when")).isEqualTo(Map.of("date", "2026-11-14"));
	}

	@Test
	@DisplayName("추천_저장한조건이있으면_계산만한번부르고응답을바꾼다")
	void recommend_stored_searchOnce() {
		searchReplies(ok());

		MeetupRecommendation recommendation = recommender.recommend(input(DESCRIPTION, STORED));

		assertThat(searchBody(1)).containsEntry("conditions", STORED.conditions());
		verify(ai, never()).post(anyString(), eq(AiMeetupClient.INTERPRET_PATH), any(), any(), any());
		verify(interpretations, never()).store(org.mockito.ArgumentMatchers.anyLong(), any(), any());
		MeetupRecommendation.Place place = recommendation.places().getFirst();
		assertThat(place.placeId()).isEqualTo(10L);
		assertThat(place.score()).isEqualTo(86);
		assertThat(place.caution()).isEqualTo("주차는 어려워요");
		assertThat(place.reasons()).extracting(MeetupRecommendation.Reason::title).containsExactly("조용해요");
		assertThat(place.members()).containsExactly(new MeetupRecommendation.MemberScore(1, 100, false, null),
				new MeetupRecommendation.MemberScore(2, 40, true, "곱창"),
				new MeetupRecommendation.MemberScore(3, null, false, null));
		// 모르는 음식 종류는 뺀다
		assertThat(recommendation.applied()).isEqualTo(new MeetupRecommendation.Applied(Mood.QUIET,
				List.of(FoodType.KOREAN), null, true, 20000, List.of("곱창")));
		assertThat(recommendation.emptyReason()).isNull();
	}

	@Test
	@DisplayName("추천_설명이없으면_해석하지않고조건없이부른다")
	void recommend_noDescription_noInterpret() {
		searchReplies(ok());

		recommender.recommend(input(null, null));

		assertThat(searchBody(1)).doesNotContainKey("conditions");
		verify(ai, never()).post(anyString(), eq(AiMeetupClient.INTERPRET_PATH), any(), any(), any());
	}

	@Test
	@DisplayName("추천_설명이있는데해석이없으면_먼저해석해저장하고그조건으로부른다")
	void recommend_missingInterpretation_interpretsFirst() {
		interpretReplies(interpreted());
		searchReplies(ok());

		recommender.recommend(input(DESCRIPTION, null));

		verify(interpretations).store(7, DESCRIPTION,
				new MeetupInterpretation(FRESH_CONDITIONS, new MeetupInterpretation.Summary(true)));
		assertThat(searchBody(1)).containsEntry("conditions", FRESH_CONDITIONS);
	}

	@Test
	@DisplayName("추천_다시해석도실패하면_계산을부르지않고실패다")
	void recommend_interpretFails_fails() {
		interpretReplies(failed());

		assertThatThrownBy(() -> recommender.recommend(input(DESCRIPTION, null)))
				.isInstanceOf(MeetupRecommenderUnavailableException.class);
		verify(ai, never()).post(anyString(), eq(AiMeetupClient.SEARCH_PATH), any(), any(), any());
	}

	@Test
	@DisplayName("추천_저장한조건을읽지못하면_지우고다시해석해한번더부른다")
	void recommend_conditionsInvalid_reinterpretsOnce() {
		interpretReplies(interpreted());
		searchReplies(new Reply<>(null, 400, "CONDITIONS_INVALID"), ok());

		MeetupRecommendation recommendation = recommender.recommend(input(DESCRIPTION, STORED));

		InOrder order = inOrder(interpretations);
		order.verify(interpretations).store(7, DESCRIPTION, null);
		order.verify(interpretations).store(7, DESCRIPTION,
				new MeetupInterpretation(FRESH_CONDITIONS, new MeetupInterpretation.Summary(true)));
		assertThat(searchBody(2)).containsEntry("conditions", FRESH_CONDITIONS);
		assertThat(recommendation.places()).hasSize(1);
	}

	@Test
	@DisplayName("추천_방금해석한조건도읽지못하면_다시해석하지않고실패다")
	void recommend_conditionsInvalidAfterFreshInterpretation_fails() {
		interpretReplies(interpreted());
		searchReplies(new Reply<>(null, 400, "CONDITIONS_INVALID"));

		assertThatThrownBy(() -> recommender.recommend(input(DESCRIPTION, null)))
				.isInstanceOf(MeetupRecommenderUnavailableException.class);
		verify(ai, times(1)).post(anyString(), eq(AiMeetupClient.INTERPRET_PATH), any(), any(), any());
		verify(ai, times(1)).post(anyString(), eq(AiMeetupClient.SEARCH_PATH), any(), any(), any());
	}

	@Test
	@DisplayName("추천_다른400이나닿지못한실패면_다시해석하지않고실패다")
	void recommend_otherFailure_fails() {
		searchReplies(new Reply<>(null, 400, "INVALID_REQUEST"));

		assertThatThrownBy(() -> recommender.recommend(input(DESCRIPTION, STORED)))
				.isInstanceOf(MeetupRecommenderUnavailableException.class);
		verify(ai, never()).post(anyString(), eq(AiMeetupClient.INTERPRET_PATH), any(), any(), any());
		verify(interpretations, never()).store(org.mockito.ArgumentMatchers.anyLong(), any(), any());
	}

	@Test
	@DisplayName("추천_후보가없으면_원인과프로필번호를바꾼다")
	void recommend_empty_reason() {
		searchReplies(new Reply<>(new AiMeetupClient.Found(null, List.of(),
				new AiMeetupClient.EmptyReason("못 먹는 음식을 빼면 남는 곳이 없어요", "다시 확인", List.of("2"))), 200, null));

		MeetupRecommendation recommendation = recommender.recommend(input(DESCRIPTION, STORED));

		assertThat(recommendation.places()).isEmpty();
		assertThat(recommendation.applied()).isEqualTo(MeetupRecommendation.Applied.NONE);
		assertThat(recommendation.emptyReason()).isEqualTo(
				new MeetupRecommendation.EmptyReason("못 먹는 음식을 빼면 남는 곳이 없어요", "다시 확인", List.of(2L)));
	}

	@Test
	@DisplayName("읽을수있는응답_장소번호와숫자프로필번호가있어야한다")
	@SuppressWarnings("unchecked")
	void readable_requiresPlaceIdsAndNumericKeys() {
		searchReplies(ok());
		recommender.recommend(input(DESCRIPTION, STORED));
		ArgumentCaptor<Predicate<AiMeetupClient.Found>> readable = ArgumentCaptor.forClass(Predicate.class);
		verify(ai).post(anyString(), eq(AiMeetupClient.SEARCH_PATH), any(), eq(AiMeetupClient.Found.class),
				readable.capture());

		AiMeetupClient.Item item = found().items().getFirst();
		assertThat(readable.getValue().test(found())).isTrue();
		assertThat(readable.getValue().test(new AiMeetupClient.Found(null, null, null))).isFalse();
		assertThat(readable.getValue().test(new AiMeetupClient.Found(null, List.of(new AiMeetupClient.Item(null,
				item.score(), item.reasons(), null, item.memberScores())), null))).isFalse();
		assertThat(readable.getValue().test(new AiMeetupClient.Found(null, List.of(new AiMeetupClient.Item(10L,
				item.score(), item.reasons(), null, List.of(new AiMeetupClient.MemberScore("민지", 90, null, null)))),
				null))).isFalse();
		assertThat(readable.getValue().test(new AiMeetupClient.Found(null, List.of(new AiMeetupClient.Item(10L,
				item.score(), item.reasons(), null, null)), null))).isFalse();
	}

	@Test
	@DisplayName("해석_음식언급이없는응답은_읽을수없어실패다")
	@SuppressWarnings("unchecked")
	void interpret_requiresSummary() {
		interpretReplies(interpreted());
		new AiMeetupClient(ai).interpret(DESCRIPTION);
		ArgumentCaptor<Predicate<AiMeetupClient.Interpreted>> readable = ArgumentCaptor.forClass(Predicate.class);
		ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
		verify(ai).post(eq("meetup interpret"), eq(AiMeetupClient.INTERPRET_PATH), body.capture(),
				eq(AiMeetupClient.Interpreted.class), readable.capture());

		assertThat(body.getValue()).isEqualTo(Map.of("text", DESCRIPTION));
		assertThat(readable.getValue().test(new AiMeetupClient.Interpreted(FRESH_CONDITIONS,
				new AiMeetupClient.Interpreted.Summary(null)))).isFalse();
		assertThat(readable.getValue().test(new AiMeetupClient.Interpreted(null,
				new AiMeetupClient.Interpreted.Summary(true)))).isFalse();
	}

}
