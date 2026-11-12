package kr.co.fitdining.api.meetup.recommend;

import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.stereotype.Component;

/** 장소 Mock 모드의 해석기. AI를 부르지 않으므로 요약이 없고 고른 업종에서 물을 수 있는 질문이 모두 보인다(AC-21). */
@Component
@ConditionalOnBooleanProperty("place.mock.enabled")
class StubMeetupInterpreter implements MeetupInterpreter {

	@Override
	public Optional<MeetupInterpretation> interpret(String description) {
		return Optional.empty();
	}

}
