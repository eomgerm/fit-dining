package kr.co.fitdining.api.meetup;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupQuestions;
import kr.co.fitdining.api.meetup.store.Meetup;
import org.springframework.stereotype.Component;

/**
 * 모임에 보일 질문(D-17, AC-49). 업종과 저장한 해석의 음식 언급으로 정하고, 메뉴 가격 질문은 가게 가격이 채워졌을 때만
 * 보인다. 가격이 채워졌는지는 스냅숏마다 읽지 않고 {@link MeetupLimits#PRICE_CHECK_TTL} 동안 기억한다.
 */
@Component
public class MeetupQuestionSource {

	private final MeetupPlaces places;
	private final Clock clock;
	private volatile PriceCheck priceCheck;

	public MeetupQuestionSource(MeetupPlaces places, Optional<Clock> clock) {
		this.places = places;
		this.clock = clock.orElseGet(Clock::systemUTC);
	}

	public MeetupQuestions questions(Meetup meetup) {
		return MeetupQuestions.of(meetup.getCategory(), mentionsFood(meetup.getParsedConditions()), pricesKnown());
	}

	/** 해석이 없으면(설명이 비었거나 해석하지 못함) 음식 언급이 없는 것으로 보고 음식 질문을 보인다. */
	private static boolean mentionsFood(MeetupInterpretation interpretation) {
		return interpretation != null && interpretation.summary() != null && interpretation.summary().mentionsFood();
	}

	private boolean pricesKnown() {
		Instant now = clock.instant();
		PriceCheck check = priceCheck;
		if (check == null || !now.isBefore(check.until())) {
			check = new PriceCheck(places.pricesKnown(), now.plus(MeetupLimits.PRICE_CHECK_TTL));
			priceCheck = check;
		}
		return check.known();
	}

	private record PriceCheck(boolean known, Instant until) {
	}

}
