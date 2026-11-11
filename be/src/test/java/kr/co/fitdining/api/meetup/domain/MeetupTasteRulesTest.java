package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 모임 취향의 정리, 보일 질문에 따른 거르기, 수정 때 숨겨진 답 지키기(AC-6, AC-10). */
class MeetupTasteRulesTest {

	private static final MeetupQuestions ALL = new MeetupQuestions(true, true, true, true);
	private static final MeetupQuestions CAFE = MeetupQuestions.of(MeetupCategory.CAFE, false, false);
	private static final Taste FULL = new Taste(Mood.QUIET, List.of(FoodType.KOREAN), List.of(FoodType.CHINESE), true,
			20_000, "곱창");

	@Test
	@DisplayName("정리_음식종류의겹침을빼고메뉴의공백을지운다")
	void normalize_dedupesFoodsAndTrimsMenu() {
		Taste taste = MeetupTasteRules.normalize(new Taste(null,
				List.of(FoodType.WESTERN, FoodType.KOREAN, FoodType.WESTERN), List.of(), null, null, "  곱창, 마라탕 "));
		assertThat(taste.likeFoods()).containsExactly(FoodType.KOREAN, FoodType.WESTERN);
		assertThat(taste.avoidFoods()).isNull();
		assertThat(taste.wantMenu()).isEqualTo("곱창, 마라탕");
	}

	@Test
	@DisplayName("정리_메뉴가공백뿐이면_없는것이다")
	void normalize_blankMenu_null() {
		assertThat(MeetupTasteRules.normalize(new Taste(null, null, null, null, null, " 　 ")).wantMenu()).isNull();
	}

	@ParameterizedTest
	@ValueSource(ints = {4_999, 100_001, 101_000})
	@DisplayName("정리_가격상한이범위밖이면_400이다")
	void normalize_priceOutOfRange_rejected(int priceCap) {
		assertThatThrownBy(() -> MeetupTasteRules.normalize(new Taste(null, null, null, null, priceCap, null)))
				.isInstanceOf(InvalidMeetupException.class);
	}

	@ParameterizedTest
	@ValueSource(ints = {5_000, 15_500, 100_000})
	@DisplayName("정리_가격상한이범위안이면_1000원단위가아니어도받는다")
	void normalize_priceInRange_accepted(int priceCap) {
		assertThat(MeetupTasteRules.normalize(new Taste(null, null, null, null, priceCap, null)).priceCap())
				.isEqualTo(priceCap);
	}

	@Test
	@DisplayName("정리_메뉴가20자를넘거나음식종류에빈값이있으면_400이다")
	void normalize_longMenuOrNullFood_rejected() {
		assertThatThrownBy(() -> MeetupTasteRules.normalize(new Taste(null, null, null, null, null, "가".repeat(21))))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> MeetupTasteRules.normalize(new Taste(null, Arrays.asList(FoodType.KOREAN, null),
				null, null, null, null))).isInstanceOf(InvalidMeetupException.class);
	}

	@Test
	@DisplayName("거르기_카페면_분위기만남는다")
	void visibleOnly_cafe_keepsMoodOnly() {
		assertThat(MeetupTasteRules.visibleOnly(FULL, CAFE))
				.isEqualTo(new Taste(Mood.QUIET, null, null, null, null, null));
	}

	@Test
	@DisplayName("수정_보이는질문은요청대로바꾸고_숨겨진답은지킨다")
	void merge_keepsHiddenAnswers() {
		Taste request = new Taste(Mood.LIVELY, null, null, null, null, null);
		assertThat(MeetupTasteRules.merge(FULL, request, CAFE))
				.isEqualTo(new Taste(Mood.LIVELY, List.of(FoodType.KOREAN), List.of(FoodType.CHINESE), true, 20_000,
						"곱창"));
	}

	@Test
	@DisplayName("수정_보이는질문에서빠진답은_비운다")
	void merge_visibleOmitted_cleared() {
		assertThat(MeetupTasteRules.merge(FULL, Taste.EMPTY, ALL)).isEqualTo(Taste.EMPTY);
	}

	@Test
	@DisplayName("이름_앞뒤공백을지우고NFC로정규화하며_10자를넘으면받지않는다")
	void profileName_trimsNormalizesAndLimits() {
		String decomposed = "민재";
		assertThat(MeetupText.profileName("  " + decomposed + " ")).isEqualTo("민재");
		assertThat(MeetupText.profileName("가".repeat(10))).hasSize(10);
		assertThat(MeetupText.profileName("가".repeat(11))).isNull();
		assertThat(MeetupText.profileName("   ")).isNull();
	}

}
