package kr.co.fitdining.api.meetup;

import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.store.Meetup;
import org.springframework.stereotype.Component;

/**
 * 모임에 보일 질문(D-17). 모임 설명 해석 요약과 가게 가격 확인은 추천 연동 단계에서 붙인다. 그 전에는 업종으로만 정하고
 * 메뉴 가격 질문은 숨긴다.
 */
@Component
public class MeetupQuestionSource {

	public MeetupQuestions questions(Meetup meetup) {
		return MeetupQuestions.of(meetup.getCategory(), false, false);
	}

}
