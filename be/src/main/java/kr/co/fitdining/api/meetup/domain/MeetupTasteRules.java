package kr.co.fitdining.api.meetup.domain;

import java.util.List;
import java.util.Objects;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;

/**
 * 모임 취향의 검증과 보일 질문에 따른 거르기(AC-6, AC-10, D-17). 질문은 넷으로 묶는다. 분위기, 음식(먹고 싶은·빼고 싶은
 * 음식 종류와 먹고 싶은 메뉴), 매운 음식, 메뉴 가격이다.
 */
public final class MeetupTasteRules {

	private MeetupTasteRules() {
	}

	/**
	 * 요청의 답을 정리한다. 음식 종류는 겹친 것을 빼고 비면 없앤다. 먹고 싶은 메뉴는 앞뒤 공백을 지우고 비면 없앤다.
	 *
	 * @throws InvalidMeetupException 메뉴 가격 상한이 범위 밖이거나, 먹고 싶은 메뉴가 길거나, 음식 종류에 빈 값이 있을 때.
	 *         가격의 1,000원 단위는 화면의 입력 단위라 보지 않는다(D-17)
	 */
	public static Taste normalize(Taste raw) {
		if (raw == null) {
			return Taste.EMPTY;
		}
		Integer priceCap = raw.priceCap();
		if (priceCap != null && (priceCap < MeetupLimits.PRICE_CAP_MIN || priceCap > MeetupLimits.PRICE_CAP_MAX)) {
			throw new InvalidMeetupException();
		}
		String wantMenu = MeetupText.trimToNull(raw.wantMenu());
		if (wantMenu != null && MeetupText.length(wantMenu) > MeetupLimits.WANT_MENU_MAX) {
			throw new InvalidMeetupException();
		}
		return new Taste(raw.mood(), foods(raw.likeFoods()), foods(raw.avoidFoods()), raw.noSpicy(), priceCap,
				wantMenu);
	}

	/** @return 지금 보이는 질문의 답만 남긴 취향. 숨겨진 질문의 답은 없앤다. */
	public static Taste visibleOnly(Taste taste, MeetupQuestions questions) {
		return merge(Taste.EMPTY, taste, questions);
	}

	/**
	 * 취향 수정. 보이는 질문의 답은 요청대로 바꾸고(빠지면 비운다), 숨겨진 질문의 답은 그대로 둔다(AC-10).
	 *
	 * @param stored 저장한 취향
	 * @param request 정리한 요청의 답
	 * @param questions 지금 보일 질문
	 */
	public static Taste merge(Taste stored, Taste request, MeetupQuestions questions) {
		return new Taste(
				questions.mood() ? request.mood() : stored.mood(),
				questions.food() ? request.likeFoods() : stored.likeFoods(),
				questions.food() ? request.avoidFoods() : stored.avoidFoods(),
				questions.spicy() ? request.noSpicy() : stored.noSpicy(),
				questions.price() ? request.priceCap() : stored.priceCap(),
				questions.food() ? request.wantMenu() : stored.wantMenu());
	}

	private static List<FoodType> foods(List<FoodType> foods) {
		if (foods == null || foods.isEmpty()) {
			return null;
		}
		if (foods.stream().anyMatch(Objects::isNull)) {
			throw new InvalidMeetupException();
		}
		return foods.stream().distinct().sorted().toList();
	}

}
