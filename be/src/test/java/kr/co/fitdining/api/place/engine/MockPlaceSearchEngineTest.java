package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 테스트 안에서 만든 영업시간으로 영업 상태 판정을 확인하고, 애플리케이션의 JSON 설정(알 수 없는 속성 거부)으로
 * places.json을 읽어 데이터 규칙을 확인한다.
 */
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

	private static List<PlaceCard> cards(MockPlaceSearchEngine engine) {
		return new ArrayList<>(engine.search(new PlaceSearchRequest("근처", null, null, null, null), null).response().items());
	}

	@Nested
	@DisplayName("Mock 장소의 영업 상태")
	class MockPlacesStatus {

		@ParameterizedTest
		@ValueSource(strings = {"2026-10-21T03:00", "2026-10-21T15:00", "2026-10-23T23:30", "2026-10-25T09:00"})
		@DisplayName("영업상태_같은시각이면_모든장소의카드와상세가같다")
		void openStatus_sameInstant_cardMatchesDetail(String seoulDateTime) {
			MockPlaceSearchEngine engine = engineAt(seoulDateTime, SEOUL);

			for (PlaceCard card : cards(engine)) {
				assertThat(engine.findPlace(card.place().id()).orElseThrow().openStatus())
						.as("id %s", card.place().id()).isEqualTo(card.openStatus());
			}
		}

		@Test
		@DisplayName("영업상태_시계의시간대가달라도_서울시각으로계산한다")
		void openStatus_utcClock_usesSeoulTime() {
			// 5번 장소(야마야 강남점)는 수요일 15:00~17:00이 브레이크다.
			MockPlaceSearchEngine engine = engineAt("2026-10-21T15:00", ZoneOffset.UTC);

			assertThat(engine.findPlace(5).orElseThrow().openStatus()).isEqualTo(OpenStatus.BREAK);
		}

		@Test
		@DisplayName("영업상태_정보없는요일이있어도_카드와상세가UNKNOWN으로응답한다")
		void openStatus_unknownHours_respondsUnknown() {
			// 6번 장소(폴 바셋 강남삼성타운점)는 7일 모두 정보 없음, 8번 장소(슬로우커피)는 금요일이 정보 없음이다.
			MockPlaceSearchEngine engine = engineAt("2026-10-23T12:00", SEOUL);

			assertThat(engine.findPlace(6).orElseThrow().openStatus()).isEqualTo(OpenStatus.UNKNOWN);
			assertThat(engine.findPlace(8).orElseThrow().openStatus()).isEqualTo(OpenStatus.UNKNOWN);
			assertThat(cards(engine)).filteredOn(card -> card.place().id() == 6).extracting(PlaceCard::openStatus)
					.containsExactly(OpenStatus.UNKNOWN);
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

			assertThat(engine.findPlace(places.size())).isPresent();
		}

		@Test
		@DisplayName("Mock데이터_장소는30에서40곳이고_id는1부터차례다")
		void data_places_countAndSequentialIds() {
			assertThat(places.size()).isBetween(30, 40);
			for (int i = 0; i < places.size(); i++) {
				assertThat(places.get(i).at("/card/place/id").asLong()).isEqualTo(i + 1);
			}
		}

		@Test
		@DisplayName("Mock데이터_카드와상세의장소는같고_영업상태는UNKNOWN이며_썸네일은첫사진이다")
		void data_cardAndDetail_samePlaceUnknownStatusThumbnailFirstPhoto() {
			for (JsonNode place : places) {
				assertThat(place.at("/card/place")).isEqualTo(place.at("/detail/place"));
				assertThat(place.at("/card/openStatus").asString()).isEqualTo("UNKNOWN");
				assertThat(place.at("/detail/openStatus").asString()).isEqualTo("UNKNOWN");
				JsonNode thumbnail = place.at("/card/place/thumbnailUrl");
				if (!thumbnail.isMissingNode()) {
					assertThat(place.at("/detail/photos/0").asString()).isEqualTo(thumbnail.asString());
				}
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
		@DisplayName("Mock데이터_영업시간은7일이고_시각은HHmm이며_시각은둘다있거나없다")
		void data_hours_sevenDaysWellFormed() {
			List<String> days = Arrays.stream(DayCode.values()).map(Enum::name).toList();
			for (JsonNode place : places) {
				JsonNode hours = place.at("/detail/hours");
				assertThat(hours.size()).isEqualTo(7);
				for (int i = 0; i < 7; i++) {
					JsonNode day = hours.get(i);
					String where = place.at("/card/place/id") + " " + days.get(i);
					assertThat(day.get("dayOfWeek").asString()).isEqualTo(days.get(i));
					assertThat(day.has("open")).as(where).isEqualTo(day.has("close"));
					if (day.get("closed").asBoolean()) {
						assertThat(day.has("open")).as(where).isFalse();
					}
					for (String field : List.of("open", "close")) {
						if (day.has(field)) {
							assertThat(day.get(field).asString()).as(where).matches(HH_MM);
						}
					}
					day.get("lastOrders").forEach(time -> assertThat(time.asString()).as(where).matches(HH_MM));
					for (JsonNode pause : day.get("breaks")) {
						assertThat(pause.get("start").asString()).as(where).matches(HH_MM);
						assertThat(pause.get("end").asString()).as(where).matches(HH_MM);
					}
				}
			}
		}

		@Test
		@DisplayName("Mock데이터_메뉴는_이름이있다")
		void data_menus_haveName() {
			for (JsonNode place : places) {
				for (JsonNode menu : place.at("/detail/menus")) {
					assertThat(menu.get("name").asString()).isNotBlank();
				}
			}
		}
	}

}
