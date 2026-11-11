package kr.co.fitdining.api.meetup.domain;

import java.util.List;

/**
 * 모임 질문의 답(모임 취향). 요청과 응답이 같은 모양이고, 모두 생략할 수 있다(AC-5, AC-6).
 *
 * @param mood 분위기. 없으면 답하지 않은 것이다.
 * @param likeFoods 먹고 싶은 음식 종류. 없거나 비면 상관없음이다.
 * @param avoidFoods 빼고 싶은 음식 종류
 * @param noSpicy 매운 걸 잘 못 먹는지
 * @param priceCap 메뉴 하나 가격 상한(원)
 * @param wantMenu 먹고 싶은 메뉴. 적은 글 그대로다(D-26).
 */
public record Taste(Mood mood, List<FoodType> likeFoods, List<FoodType> avoidFoods, Boolean noSpicy,
		Integer priceCap, String wantMenu) {

	public static final Taste EMPTY = new Taste(null, null, null, null, null, null);

	public boolean isEmpty() {
		return equals(EMPTY);
	}

}
