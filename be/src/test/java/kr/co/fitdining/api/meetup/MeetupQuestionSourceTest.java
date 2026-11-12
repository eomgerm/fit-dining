package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.meetup.area.MeetupArea;
import kr.co.fitdining.api.meetup.area.MeetupPlaces;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.store.Meetup;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 보일 질문의 해석 요약과 가게 가격 판단(AC-49, D-17) */
class MeetupQuestionSourceTest {

	static final Instant NOW = Instant.parse("2026-11-12T03:00:00Z");

	static final class MovingClock extends Clock {
		Instant instant = NOW;

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return instant;
		}
	}

	static final class CountingPlaces implements MeetupPlaces {
		boolean known;
		int checks;

		@Override
		public List<MeetupArea> areas() {
			return List.of();
		}

		@Override
		public Map<Long, PlaceDetailResponse> details(Collection<Long> ids) {
			return Map.of();
		}

		@Override
		public PlacesAround around(kr.co.fitdining.api.meetup.domain.MeetupPoint point) {
			return new PlacesAround(0, null);
		}

		@Override
		public boolean pricesKnown() {
			checks++;
			return known;
		}
	}

	final MovingClock clock = new MovingClock();
	final CountingPlaces places = new CountingPlaces();
	final MeetupQuestionSource source = new MeetupQuestionSource(places, Optional.of(clock));

	static Meetup meetup(MeetupCategory category, String description, Boolean mentionsFood) {
		Meetup meetup = new Meetup("code", "host", AreaKind.STATION, "선릉", category, null, null, null, description,
				NOW, NOW);
		if (mentionsFood != null) {
			meetup.interpreted(description, new MeetupInterpretation(Map.of("version", 3),
					new MeetupInterpretation.Summary(mentionsFood)));
		}
		return meetup;
	}

	@Test
	@DisplayName("질문_해석요약에음식언급이있으면_음식질문을숨긴다")
	void questions_mentionsFood_hidesFood() {
		assertThat(source.questions(meetup(MeetupCategory.RESTAURANT, "곱창 먹을 곳", true)).food()).isFalse();
		assertThat(source.questions(meetup(MeetupCategory.RESTAURANT, "조용한 곳", false)).food()).isTrue();
		assertThat(source.questions(meetup(MeetupCategory.ANY, "곱창 먹을 곳", true)).food()).isFalse();
	}

	@Test
	@DisplayName("질문_해석이없으면_고른업종에서물을수있는질문을모두보인다")
	void questions_noInterpretation_allQuestions() {
		assertThat(source.questions(meetup(MeetupCategory.RESTAURANT, "곱창 먹을 곳", null)).food()).isTrue();
		assertThat(source.questions(meetup(MeetupCategory.CAFE, "곱창 먹을 곳", null)).food()).isFalse();
	}

	@Test
	@DisplayName("질문_가게가격이채워졌는지는_10분동안기억하고지나면다시본다")
	void questions_pricesKnown_rememberedTenMinutes() {
		Meetup meetup = meetup(MeetupCategory.RESTAURANT, null, null);

		assertThat(source.questions(meetup).price()).isFalse();
		places.known = true;
		clock.instant = NOW.plus(Duration.ofMinutes(10)).minusSeconds(1);
		assertThat(source.questions(meetup).price()).isFalse();
		assertThat(places.checks).isEqualTo(1);

		clock.instant = NOW.plus(Duration.ofMinutes(10));
		assertThat(source.questions(meetup).price()).isTrue();
		assertThat(places.checks).isEqualTo(2);
	}

}
