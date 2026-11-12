package kr.co.fitdining.api.meetup.dto;

/**
 * 모임 지점의 반경 안 장소 수와 붙일 이름(AC-58).
 *
 * @param placeCount 반경 안 장소 수
 * @param name 반경 안 장소에 가장 많은 동 이름에 "근처"를 붙인 것. 장소가 없거나 동을 모르면 빠진다.
 */
public record MeetupAreaCheckResponse(int placeCount, String name) {
}
