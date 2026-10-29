package kr.co.fitdining.api.place.dto;

/**
 * 자동완성 후보 1개.
 *
 * @param type 후보 종류
 * @param place 후보 장소. {@code PLACE}일 때만 있다.
 * @param matchedMenu 이름이 아니라 메뉴 이름으로 일치했을 때, 일치한 메뉴 이름. 화면에 "메뉴: ..."로 보인다.
 *        DB 모드는 이름, 업종, 위치로 채워지지 않는 단어가 있을 때만 담는다(place-lookup-db D-10).
 * @param label 화면 문구. {@code ACTION}일 때만 있다("이 조건으로 추천받기").
 */
public record PlaceSuggestResponse(
		SuggestType type,
		PlaceSummary place,
		String matchedMenu,
		String label
) {

	/** 자동완성 후보 종류 */
	public enum SuggestType {
		/** 장소 후보. 고르면 장소 상세로 간다. */
		PLACE,
		/** "이 조건으로 추천받기". 고르면 입력한 문장으로 추천 검색을 한다. */
		ACTION
	}

}
