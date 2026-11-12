package kr.co.fitdining.api.meetup.recommend;

import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;

/**
 * 모임 설명 해석의 포트(D-14). DB 모드에서는 AI 해석 주소를 부르고, 장소 Mock 모드에서는 해석하지 않는다(AC-21).
 */
public interface MeetupInterpreter {

	/**
	 * @param description 앞뒤 공백을 지운 모임 설명
	 * @return 해석 결과. 해석하지 않거나 실패하면 빈 값이다. 실패해도 예외를 던지지 않는다(AC-48).
	 */
	Optional<MeetupInterpretation> interpret(String description);

}
