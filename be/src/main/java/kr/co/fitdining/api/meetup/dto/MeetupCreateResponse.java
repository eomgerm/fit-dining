package kr.co.fitdining.api.meetup.dto;

import kr.co.fitdining.api.meetup.domain.MeetupQuestions;

/**
 * 만든 모임.
 *
 * @param code 모임 코드. 링크는 {@code /m/{code}}다.
 * @param questions 모임장의 질문지에 보일 질문
 */
public record MeetupCreateResponse(String code, MeetupQuestions questions) {
}
