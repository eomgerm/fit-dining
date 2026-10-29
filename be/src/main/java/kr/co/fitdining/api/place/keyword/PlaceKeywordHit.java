package kr.co.fitdining.api.place.keyword;

import kr.co.fitdining.api.place.dto.PlaceSummary;

/**
 * 키워드 검색의 히트 하나.
 *
 * @param place 후보 장소
 * @param matchedMenu 이름, 업종, 위치로 채워지지 않는 단어를 담은 메뉴 이름. 없으면 null이다.
 * @param namePrefix 이름이 입력 전체로 시작하면(순위 0) true. 자동완성의 "이 조건으로 추천받기" 위치를 정한다.
 */
public record PlaceKeywordHit(PlaceSummary place, String matchedMenu, Boolean namePrefix) {
}
