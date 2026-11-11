package kr.co.fitdining.api.meetup.dto;

import jakarta.validation.constraints.NotNull;
import kr.co.fitdining.api.meetup.domain.Taste;

/**
 * 프로필 만들기와 취향 남기기(AC-5).
 *
 * @param name 이름. 앞뒤 공백을 지운 값이 1~10자다.
 * @param taste 모임 취향. 생략할 수 있고, 보이지 않는 질문의 답은 저장하지 않는다.
 */
public record ProfileCreateRequest(@NotNull String name, Taste taste) {
}
