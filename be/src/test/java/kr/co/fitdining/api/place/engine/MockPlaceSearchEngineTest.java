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
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Break;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
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
	/** 날짜와 요일. 2026-10-19가 월요일이다. */
	private static final Map<DayCode, String> DATES = Map.of(
			DayCode.MON, "2026-10-19", DayCode.TUE, "2026-10-20", DayCode.WED, "2026-10-21",
			DayCode.THU, "2026-10-22", DayCode.FRI, "2026-10-23", DayCode.SAT, "2026-10-24",
			DayCode.SUN, "2026-10-25");

	@Autowired
	JsonMapper jsonMapper;

	private MockPlaceSearchEngine engineAt(String seoulDateTime, ZoneId clockZone) {
		var instant = LocalDateTime.parse(seoulDateTime).atZone(SEOUL).toInstant();
		return new MockPlaceSearchEngine(jsonMapper, Optional.of(Clock.fixed(instant, clockZone)));
	}

	private static List<PlaceCard> cards(MockPlaceSearchEngine engine) {
		return new ArrayList<>(engine.search(new PlaceSearchRequest("근처", null, null, null, null)).items());
	}

	/** 요일별 영업시간. 적지 않은 요일은 정보 없음이다. */
	private static final class Week {

		private final Map<DayCode, Hours> days = new EnumMap<>(DayCode.class);

		Week open(DayCode day, String open, String close, Break... breaks) {
			days.put(day, new Hours(day, open, close, List.of(breaks), List.of(), false));
			return this;
		}

		Week everyDay(String open, String close) {
			Arrays.stream(DayCode.values()).forEach(day -> open(day, open, close));
			return this;
		}

		Week closed(DayCode day) {
			days.put(day, new Hours(day, null, null, List.of(), List.of(), true));
			return this;
		}

		List<Hours> hours() {
			return Arrays.stream(DayCode.values())
					.map(day -> days.getOrDefault(day, new Hours(day, null, null, List.of(), List.of(), false)))
					.toList();
		}

		OpenStatus at(DayCode day, String time) {
			return MockPlaceSearchEngine.openStatus(hours(), LocalDateTime.parse(DATES.get(day) + "T" + time));
		}
	}

	private static Break pause(String start, String end) {
		return new Break(start, end);
	}

	@Nested
	@DisplayName("영업 상태 판정")
	class OpenStatusRules {

		/** 평일 11:00~22:00, 브레이크 15:00~17:00, 토요일 정보 없음, 일요일 휴무. */
		private final Week weekdays = new Week()
				.open(DayCode.MON, "11:00", "22:00", pause("15:00", "17:00"))
				.open(DayCode.TUE, "11:00", "22:00", pause("15:00", "17:00"))
				.open(DayCode.WED, "11:00", "22:00", pause("15:00", "17:00"))
				.open(DayCode.THU, "11:00", "22:00", pause("15:00", "17:00"))
				.open(DayCode.FRI, "11:00", "22:00", pause("15:00", "17:00"))
				.closed(DayCode.SUN);

		@ParameterizedTest(name = "{0} → {1}")
		@CsvSource({
				"10:59, CLOSED",
				"11:00, OPEN",
				"14:59, OPEN",
				"15:00, BREAK",
				"16:59, BREAK",
				"17:00, OPEN",
				"20:59, OPEN",
				"21:00, CLOSING_SOON",
				"21:59, CLOSING_SOON",
				"22:00, CLOSED",
				"23:59, CLOSED"
		})
		@DisplayName("영업상태_하루안의영업시간이면_영업중브레이크곧마감과개점전마감뒤를가른다")
		void openStatus_sameDayHours_classifiesTime(String time, OpenStatus expected) {
			assertThat(weekdays.at(DayCode.WED, time)).isEqualTo(expected);
		}

		@Test
		@DisplayName("영업상태_휴무일은_CLOSED다")
		void openStatus_closedDay_closed() {
			assertThat(weekdays.at(DayCode.SUN, "12:00")).isEqualTo(OpenStatus.CLOSED);
		}

		@Test
		@DisplayName("영업상태_브레이크가없는날은_오후에도영업중이다")
		void openStatus_noBreak_openInAfternoon() {
			Week noBreak = new Week().everyDay("11:00", "22:00");

			assertThat(noBreak.at(DayCode.WED, "15:30")).isEqualTo(OpenStatus.OPEN);
		}

		@ParameterizedTest(name = "화 {0} → {1}")
		@CsvSource({
				"00:59, OPEN",
				"01:00, CLOSING_SOON",
				"01:30, CLOSING_SOON",
				"02:00, CLOSED"
		})
		@DisplayName("영업상태_자정을넘는영업은_다음날새벽까지어제구간으로판정한다")
		void openStatus_overnight_continuesIntoNextDay(String time, OpenStatus expected) {
			Week overnight = new Week().open(DayCode.MON, "17:00", "02:00").closed(DayCode.TUE);

			assertThat(overnight.at(DayCode.TUE, time)).isEqualTo(expected);
		}

		@ParameterizedTest(name = "화 {0} → {1}")
		@CsvSource({
				"00:59, OPEN",
				"03:00, UNKNOWN"
		})
		@DisplayName("영업상태_오늘이정보없음이면_어제구간밖은UNKNOWN이다")
		void openStatus_overnightIntoUnknownDay_unknownAfterwards(String time, OpenStatus expected) {
			Week overnight = new Week().open(DayCode.MON, "17:00", "02:00");

			assertThat(overnight.at(DayCode.TUE, time)).isEqualTo(expected);
		}

		@ParameterizedTest
		@ValueSource(strings = {"MON", "WED", "SUN"})
		@DisplayName("영업상태_7일내내24시간이면_밤에도곧마감이아니다")
		void openStatus_allDayEveryDay_openAtNight(DayCode day) {
			Week allDay = new Week().everyDay("00:00", "00:00");

			assertThat(allDay.at(day, "23:30")).isEqualTo(OpenStatus.OPEN);
			assertThat(allDay.at(day, "00:00")).isEqualTo(OpenStatus.OPEN);
		}

		@Test
		@DisplayName("영업상태_다음날로이어지지않는24시간은_자정전에곧마감이다")
		void openStatus_allDayNotContinued_closingSoonBeforeMidnight() {
			Week oneDay = new Week().open(DayCode.MON, "00:00", "00:00").closed(DayCode.TUE);

			assertThat(oneDay.at(DayCode.MON, "22:59")).isEqualTo(OpenStatus.OPEN);
			assertThat(oneDay.at(DayCode.MON, "23:30")).isEqualTo(OpenStatus.CLOSING_SOON);
			assertThat(oneDay.at(DayCode.TUE, "00:00")).isEqualTo(OpenStatus.CLOSED);
		}

		@Test
		@DisplayName("영업상태_마감에다음날개점이이어지면_한구간으로보고그끝으로곧마감을가른다")
		void openStatus_closeMeetsNextOpen_mergedIntoOneInterval() {
			Week chained = new Week().open(DayCode.MON, "00:00", "00:00").open(DayCode.TUE, "00:00", "02:00");

			assertThat(chained.at(DayCode.MON, "23:30")).isEqualTo(OpenStatus.OPEN);
			assertThat(chained.at(DayCode.TUE, "01:30")).isEqualTo(OpenStatus.CLOSING_SOON);
		}

		@ParameterizedTest(name = "{0} → {1}")
		@CsvSource({
				"09:00, OPEN",
				"09:30, BREAK",
				"12:00, OPEN",
				"14:30, BREAK",
				"17:59, BREAK",
				"18:00, OPEN"
		})
		@DisplayName("영업상태_브레이크가여러개면_각브레이크안을BREAK로본다")
		void openStatus_multipleBreaks_eachIsBreak(String time, OpenStatus expected) {
			Week twoBreaks = new Week().open(DayCode.WED, "06:30", "21:30", pause("09:30", "12:00"),
					pause("14:30", "18:00"));

			assertThat(twoBreaks.at(DayCode.WED, time)).isEqualTo(expected);
		}

		@Test
		@DisplayName("영업상태_자정넘은구간의브레이크도_그구간에서판정한다")
		void openStatus_breakAfterMidnight_breakInYesterdayInterval() {
			Week overnight = new Week().open(DayCode.MON, "18:00", "04:00", pause("00:30", "01:00"))
					.closed(DayCode.TUE);

			assertThat(overnight.at(DayCode.TUE, "00:45")).isEqualTo(OpenStatus.BREAK);
			assertThat(overnight.at(DayCode.MON, "18:30")).isEqualTo(OpenStatus.OPEN);
		}

		@ParameterizedTest(name = "화 {0} → {1}")
		@CsvSource({
				"03:00, UNKNOWN",
				"08:00, UNKNOWN",
				"09:00, OPEN",
				"21:30, CLOSING_SOON",
				"22:00, CLOSED"
		})
		@DisplayName("영업상태_어제가정보없음이면_오늘첫구간전은UNKNOWN이고_그뒤는오늘시간표대로다")
		void openStatus_yesterdayUnknown_unknownBeforeFirstOpen(String time, OpenStatus expected) {
			Week week = new Week().open(DayCode.TUE, "09:00", "22:00");

			assertThat(week.at(DayCode.TUE, time)).isEqualTo(expected);
		}

		@Test
		@DisplayName("영업상태_오늘이휴무면_어제가정보없음이어도CLOSED다")
		void openStatus_todayClosedYesterdayUnknown_closed() {
			Week week = new Week().closed(DayCode.TUE);

			assertThat(week.at(DayCode.TUE, "03:00")).isEqualTo(OpenStatus.CLOSED);
		}

		@Test
		@DisplayName("영업상태_어제가휴무면_오늘개점전은CLOSED다")
		void openStatus_yesterdayClosed_closedBeforeOpen() {
			Week week = new Week().closed(DayCode.MON).open(DayCode.TUE, "09:00", "22:00");

			assertThat(week.at(DayCode.TUE, "08:00")).isEqualTo(OpenStatus.CLOSED);
		}
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
