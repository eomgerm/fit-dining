package kr.co.fitdining.api.meetup.dto;

/**
 * 만든 프로필. 모임 쿠키는 응답 헤더로 준다.
 *
 * @param profileId 프로필 id
 */
public record ProfileCreateResponse(long profileId) {
}
