package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 애플리케이션의 JSON 설정(알 수 없는 속성 거부)으로 places.json을 읽어 데이터 규칙과 영업 상태를 확인한다. */
@JsonTest
class MockPlaceSearchEngineTest {

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
	private static final Pattern HH_MM = Pattern.compile("([01][0-9]|2[0-3]):[0-5][0-9]");

	@Autowired
	JsonMapper jsonMapper;

	private MockPlaceSearchEngine engineAt(String seoulDateTime, ZoneId clockZone) {
		var instant = LocalDateTime.parse(seoulDateTime).atZone(SEOUL).toInstant();
		return new MockPlaceSearchEngine(jsonMapper, Optional.of(Clock.fixed(instant, clockZone)));
	}

	private static OpenStatus cardStatus(MockPlaceSearchEngine engine, long id) {
		List<PlaceCard> cards = new ArrayList<>(
				engine.search(new PlaceSearchRequest("근처", null, null, null, null)).items());
		return cards.stream().filter(card -> card.place().id() == id).findFirst().orElseThrow().openStatus();
	}

	@Nested
	@DisplayName("영업 상태")
	class OpenStatusAt {

		// 1번 장소: 평일 11:00~22:00, 브레이크 15:00~17:00, 일요일 휴무. 2026-10-21은 수요일이다.
		@ParameterizedTest(name = "{0} → {1}")
		@CsvSource({
				"2026-10-21T10:59, CLOSED",
				"2026-10-21T11:00, OPEN",
				"2026-10-21T14:59, OPEN",
				"2026-10-21T15:00, BREAK",
				"2026-10-21T16:59, BREAK",
				"2026-10-21T17:00, OPEN",
				"2026-10-21T20:59, OPEN",
				"2026-10-21T21:00, CLOSING_SOON",
				"2026-10-21T21:59, CLOSING_SOON",
				"2026-10-21T22:00, CLOSED",
				"2026-10-25T12:00, CLOSED"
		})
		@DisplayName("영업상태_고정한시각에서_영업시간과브레이크와휴무로계산한다")
		void openStatus_fixedClock_computedFromHours(String seoulDateTime, OpenStatus expected) {
			MockPlaceSearchEngine engine = engineAt(seoulDateTime, SEOUL);

			assertThat(cardStatus(engine, 1)).isEqualTo(expected);
		}

		@Test
		@DisplayName("영업상태_브레이크가없는장소는_오후에도영업중이다")
		void openStatus_noBreak_openInAfternoon() {
			// 9번 장소는 브레이크가 없다.
			MockPlaceSearchEngine engine = engineAt("2026-10-21T15:30", SEOUL);

			assertThat(cardStatus(engine, 9)).isEqualTo(OpenStatus.OPEN);
		}

		@Test
		@DisplayName("영업상태_시계의시간대가달라도_서울시각으로계산한다")
		void openStatus_utcClock_usesSeoulTime() {
			MockPlaceSearchEngine engine = engineAt("2026-10-21T15:00", ZoneOffset.UTC);

			assertThat(cardStatus(engine, 1)).isEqualTo(OpenStatus.BREAK);
		}

		@Test
		@DisplayName("영업상태_응답에는_UNKNOWN이남지않는다")
		void openStatus_anyTime_neverUnknown() {
			MockPlaceSearchEngine engine = engineAt("2026-10-21T12:00", SEOUL);

			assertThat(engine.search(new PlaceSearchRequest("근처", null, null, null, null)).items())
					.extracting(PlaceCard::openStatus)
					.doesNotContain(OpenStatus.UNKNOWN);
		}
	}

	@Nested
	@DisplayName("Mock 데이터")
	class Data {

		private JsonNode places;

		@BeforeEach
		void readFile() throws IOException {
			try (InputStream in = new ClassPathResource("mock/places.json").getInputStream()) {
				places = jsonMapper.readTree(in).get("places");
			}
		}

		@Test
		@DisplayName("Mock데이터_애플리케이션JSON설정으로_읽힌다")
		void data_appJsonSettings_loads() {
			MockPlaceSearchEngine engine = engineAt("2026-10-21T12:00", SEOUL);

			assertThat(engine.search(new PlaceSearchRequest("근처", null, null, null, null)).items()).hasSize(places.size());
		}

		@Test
		@DisplayName("Mock데이터_장소는25에서39곳이고_id는1부터차례다")
		void data_places_countAndSequentialIds() {
			assertThat(places.size()).isBetween(25, 39);
			for (int i = 0; i < places.size(); i++) {
				assertThat(places.get(i).at("/card/place/id").asLong()).isEqualTo(i + 1);
			}
		}

		@Test
		@DisplayName("Mock데이터_카드와상세의장소는같고_영업상태는UNKNOWN이며_사진은비어있다")
		void data_cardAndDetail_samePlaceUnknownStatusNoPhotos() {
			for (JsonNode place : places) {
				assertThat(place.at("/card/place")).isEqualTo(place.at("/detail/place"));
				assertThat(place.at("/card/openStatus").asString()).isEqualTo("UNKNOWN");
				assertThat(place.at("/detail/openStatus").asString()).isEqualTo("UNKNOWN");
				assertThat(place.at("/card/place/thumbnailUrl").isMissingNode()).isTrue();
				assertThat(place.at("/detail/photos").isEmpty()).isTrue();
			}
		}

		@Test
		@DisplayName("Mock데이터_점수라벨태그점수항목이_규칙을지킨다")
		void data_cardsAndTags_followRules() {
			for (JsonNode place : places) {
				JsonNode card = place.get("card");
				assertThat(card.get("score").isInt()).isTrue();
				assertThat(card.get("score").asInt()).isBetween(0, 100);
				assertThat(card.get("labels").size()).isEqualTo(2);
				assertThat(card.get("reasons").isEmpty()).isFalse();
				assertThat(place.at("/detail/tags").size()).isBetween(2, 4);

				JsonNode scoreItems = card.get("scoreItems");
				assertThat(scoreItems.size()).isBetween(2, 4);
				boolean anyUnmatched = false;
				for (JsonNode item : scoreItems) {
					assertThat(item.get("evidenceCount").isInt()).isTrue();
					assertThat(item.get("evidenceCount").asInt()).isGreaterThanOrEqualTo(0);
					anyUnmatched |= !item.get("matched").asBoolean();
				}
				assertThat(anyUnmatched).as("matched: false인 점수 항목, id %s", card.at("/place/id")).isTrue();
			}
		}

		@Test
		@DisplayName("Mock데이터_영업시간은7일이고_자정을넘지않는다")
		void data_hours_sevenDaysWithinADay() {
			List<String> days = List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");
			for (JsonNode place : places) {
				JsonNode hours = place.at("/detail/hours");
				assertThat(hours.size()).isEqualTo(7);
				for (int i = 0; i < 7; i++) {
					JsonNode day = hours.get(i);
					assertThat(day.get("dayOfWeek").asString()).isEqualTo(days.get(i));
					day.get("lastOrders").forEach(time -> assertThat(time.asString()).matches(HH_MM));
					if (day.get("closed").asBoolean()) {
						assertThat(day.has("open")).isFalse();
						continue;
					}
					LocalTime open = time(day, "open");
					LocalTime close = time(day, "close");
					assertThat(open).isBefore(close);
					if (day.has("breakStart") || day.has("breakEnd")) {
						LocalTime breakStart = time(day, "breakStart");
						LocalTime breakEnd = time(day, "breakEnd");
						assertThat(breakStart).isAfter(open).isBefore(breakEnd);
						assertThat(breakEnd).isBefore(close);
					}
				}
			}
		}

		@Test
		@DisplayName("Mock데이터_메뉴는_분류와이름이있다")
		void data_menus_haveCategoryAndName() {
			for (JsonNode place : places) {
				assertThat(place.at("/detail/menus").isEmpty()).isFalse();
				for (JsonNode menu : place.at("/detail/menus")) {
					assertThat(menu.get("category").asString()).isNotBlank();
					assertThat(menu.get("name").asString()).isNotBlank();
				}
			}
		}

		private static LocalTime time(JsonNode day, String field) {
			String value = day.get(field).asString();
			assertThat(value).matches(HH_MM);
			return LocalTime.parse(value);
		}
	}

}
