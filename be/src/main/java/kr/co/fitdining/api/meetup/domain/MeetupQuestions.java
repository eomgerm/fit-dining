package kr.co.fitdining.api.meetup.domain;

/**
 * 질문지에 보일 질문(D-17, AC-49). 분위기는 늘 있다. 음식 종류와 먹고 싶은 메뉴는 함께 보이고 숨는다.
 *
 * @param mood 분위기
 * @param food 음식 종류(좋아하는·못 먹는)와 먹고 싶은 메뉴
 * @param spicy 매운 음식
 * @param price 메뉴 가격 상한
 */
public record MeetupQuestions(boolean mood, boolean food, boolean spicy, boolean price) {

	/**
	 * @param category 모임 업종
	 * @param mentionsFood 모임 설명 해석 요약에 음식 종류나 메뉴가 있는지. 해석이 없으면 false다.
	 * @param priceKnown 가게 가격이 있는 장소가 하나라도 있는지
	 * @return 보일 질문
	 */
	public static MeetupQuestions of(MeetupCategory category, boolean mentionsFood, boolean priceKnown) {
		return switch (category) {
			case CAFE -> new MeetupQuestions(true, false, false, false);
			case BAR -> new MeetupQuestions(true, false, true, false);
			case RESTAURANT, ANY -> new MeetupQuestions(true, !mentionsFood, true, priceKnown);
		};
	}

}
