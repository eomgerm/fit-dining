package kr.co.fitdining.api.meetup.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 업종, 해석 요약, 가게 가격으로 보일 질문을 정한다(AC-49). */
class MeetupQuestionsTest {

	@Test
	@DisplayName("질문_카페면_분위기만있다")
	void of_cafe_moodOnly() {
		assertThat(MeetupQuestions.of(MeetupCategory.CAFE, false, true))
				.isEqualTo(new MeetupQuestions(true, false, false, false));
	}

	@Test
	@DisplayName("질문_술집이면_분위기와매운음식만있다")
	void of_bar_moodAndSpicy() {
		assertThat(MeetupQuestions.of(MeetupCategory.BAR, false, true))
				.isEqualTo(new MeetupQuestions(true, false, true, false));
	}

	@Test
	@DisplayName("질문_식당이고요약에음식이없으면_음식질문이있다")
	void of_restaurantWithoutFoodMention_food() {
		assertThat(MeetupQuestions.of(MeetupCategory.RESTAURANT, false, false))
				.isEqualTo(new MeetupQuestions(true, true, true, false));
	}

	@Test
	@DisplayName("질문_상관없음이고요약에음식이있으면_음식질문이없다")
	void of_anyWithFoodMention_noFood() {
		assertThat(MeetupQuestions.of(MeetupCategory.ANY, true, false))
				.isEqualTo(new MeetupQuestions(true, false, true, false));
	}

	@Test
	@DisplayName("질문_식당이고가게가격이있으면_가격질문이있다")
	void of_restaurantWithPrice_price() {
		assertThat(MeetupQuestions.of(MeetupCategory.RESTAURANT, false, true).price()).isTrue();
	}

}
