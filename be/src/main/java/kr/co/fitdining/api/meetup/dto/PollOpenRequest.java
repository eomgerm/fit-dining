package kr.co.fitdining.api.meetup.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;

/**
 * 투표 열기(AC-36).
 *
 * @param placeIds 후보. 지금 결과 안의 서로 다른 장소 2~5곳이고, 이 순서로 보인다.
 * @param anonymous 익명 투표인지. 빼면 익명이다.
 */
public record PollOpenRequest(
		@NotNull @Size(min = MeetupLimits.POLL_CANDIDATES_MIN, max = MeetupLimits.POLL_CANDIDATES_MAX)
		List<@NotNull Long> placeIds,
		Boolean anonymous) {
}
