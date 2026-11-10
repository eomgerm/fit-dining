package kr.co.fitdining.api.place.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.user.Preferences;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
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

	/** 모든 장소의 카드. SEARCH 페이지를 끝까지 넘겨 모은다. */
	private static List<PlaceCard> cards(MockPlaceSearchEngine engine) {
		List<PlaceCard> cards = new ArrayList<>();
		String cursor = null;
		do {
			PlaceSearchResponse page = engine.search(SearchPurpose.SEARCH,
					new PlaceSearchRequest("카페", null, null, null, cursor), null).response();
			cards.addAll(page.items());
			cursor = page.nextCursor();
		} while (cursor != null);
		return cards;
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

	/** 목적별 응답(place-ai-search AC-22, AC-33 ~ AC-35). mock 장소 36곳은 모두 강남 근처다. */
	@Nested
	@DisplayName("목적별 응답")
	class Purposes {

		/** mock 장소 전체를 담는 영역 */
		static final MapBounds ALL = new MapBounds(37.49, 127.02, 37.51, 127.06);
		/** 경도 127.04 서쪽. mock 장소 21곳이 있다 */
		static final MapBounds WEST = new MapBounds(37.49, 127.02, 37.51, 127.04);
		/** 10번(37.5027093, 127.0518337)과 13번(37.5027789, 127.0504034)이 정확히 모서리에 있는 영역 */
		static final MapBounds CORNERS = new MapBounds(37.5027093, 127.0504034, 37.5027789, 127.0518337);
		/** 대전. mock 장소가 없다 */
		static final MapBounds DAEJEON = new MapBounds(36.35, 127.33, 36.37, 127.36);

		final MockPlaceSearchEngine engine = engineAt("2026-10-21T12:00", SEOUL);

		@AfterEach
		void clearRequest() {
			RequestContextHolder.resetRequestAttributes();
		}

		PlaceSearchResponse nearby(MapBounds area) {
			return engine.search(SearchPurpose.NEARBY, new PlaceSearchRequest(SearchPurpose.NEARBY_QUERY, null, null, area,
					null), null).response();
		}

		PlaceSearchResponse region(MapBounds area, Map<String, Object> conditions, String cursor) {
			return engine.search(SearchPurpose.REGION, new PlaceSearchRequest("파스타", null, conditions, area, cursor),
					null).response();
		}

		void emptyScenario() {
			MockHttpServletRequest request = new MockHttpServletRequest();
			request.addHeader("X-Mock-Scenario", "empty");
			RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
		}

		@Test
		@DisplayName("NEARBY_영역이모든장소를담으면_점수상위10곳을커서없이nearby로준다")
		void nearby_wholeArea_topTenByScore() {
			PlaceSearchResponse response = nearby(ALL);
			List<PlaceCard> firstSearchPage = engine.search(SearchPurpose.SEARCH,
					new PlaceSearchRequest("카페", null, null, null, null), null).response().items();

			assertThat(response.items()).hasSize(10);
			assertThat(response.items()).extracting(card -> card.place().id())
					.containsExactlyElementsOf(firstSearchPage.subList(0, 10).stream().map(card -> card.place().id())
							.toList());
			assertThat(response.nearby()).isTrue();
			assertThat(response.conditions()).isEmpty();
			assertThat(response.totalCount()).isEqualTo(10);
			assertThat(response.nextCursor()).isNull();
			assertThat(response.changeSummary()).isNull();
			assertThat(response.emptyReason()).isNull();
		}

		@Test
		@DisplayName("NEARBY_모서리에있는장소도_영역안이고점수순이다")
		void nearby_cornerPlaces_includedByScore() {
			PlaceSearchResponse response = nearby(CORNERS);

			assertThat(response.items()).extracting(card -> card.place().id()).containsExactly(13L, 10L);
			assertThat(response.totalCount()).isEqualTo(2);
		}

		@Test
		@DisplayName("NEARBY_영역에장소가없으면_빈목록과기존emptyReason이고nearby다")
		void nearby_noPlaces_emptyReason() {
			PlaceSearchResponse response = nearby(DAEJEON);

			assertThat(response.items()).isEmpty();
			assertThat(response.totalCount()).isZero();
			assertThat(response.nearby()).isTrue();
			assertThat(response.emptyReason()).isEqualTo(MockPlaceSearchEngine.EMPTY_REASON);
		}

		@Test
		@DisplayName("NEARBY_empty시나리오여도_nearby다")
		void nearby_emptyScenario_stillNearby() {
			emptyScenario();

			PlaceSearchResponse response = nearby(ALL);

			assertThat(response.items()).isEmpty();
			assertThat(response.totalCount()).isZero();
			assertThat(response.nearby()).isTrue();
			assertThat(response.emptyReason()).isEqualTo(MockPlaceSearchEngine.EMPTY_REASON);
		}

		@Test
		@DisplayName("NEARBY_취향답변은_결과를바꾸지않는다")
		void nearby_preferences_ignored() {
			PlaceSearchResponse withPreferences = engine.search(SearchPurpose.NEARBY, new PlaceSearchRequest(
					SearchPurpose.NEARBY_QUERY, new Preferences(Preferences.Mood.LIVELY, null, null, null), null, ALL,
					null), null).response();

			assertThat(withPreferences.items()).isEqualTo(nearby(ALL).items());
		}

		@Test
		@DisplayName("REGION_영역안장소를20곳씩나누고다음페이지도같은영역에서센다")
		void region_twoPages_withinArea() {
			PlaceSearchResponse first = region(WEST, null, null);
			PlaceSearchResponse second = region(WEST, null, first.nextCursor());

			assertThat(first.items()).hasSize(20);
			assertThat(first.totalCount()).isEqualTo(21);
			assertThat(first.nextCursor()).isNotNull();
			assertThat(second.items()).hasSize(1);
			assertThat(second.totalCount()).isEqualTo(21);
			assertThat(second.nextCursor()).isNull();
			assertThat(second.emptyReason()).isNull();
			List<PlaceCard> all = new ArrayList<>(first.items());
			all.addAll(second.items());
			assertThat(all).allSatisfy(card -> assertThat(card.place().lng()).isBetween(127.02, 127.04));
			assertThat(all).extracting(card -> card.place().id()).doesNotHaveDuplicates();
			assertThat(all).extracting(PlaceCard::score).isSortedAccordingTo(java.util.Comparator.reverseOrder());
		}

		@Test
		@DisplayName("REGION_받은조건을돌려주고nearby와변경요약이없다")
		void region_conditions_echoedWithoutSummary() {
			Map<String, Object> conditions = new HashMap<>();
			conditions.put("text", "강남역 파스타");
			conditions.put("unset", null);
			PlaceSearchResponse first = region(WEST, conditions, null);
			PlaceSearchResponse second = region(WEST, conditions, first.nextCursor());

			for (PlaceSearchResponse response : List.of(first, second)) {
				assertThat(response.conditions()).isEqualTo(conditions);
				assertThat(response.nearby()).isFalse();
				assertThat(response.changeSummary()).isNull();
			}
			assertThat(region(WEST, null, null).conditions()).isEmpty();
		}

		@Test
		@DisplayName("REGION_빈문자열커서는첫페이지이고_영역밖으로넘긴커서는빈목록만준다")
		void region_emptyCursorFirstPage_offsetBeyondEmpty() {
			assertThat(region(WEST, null, "").items()).isEqualTo(region(WEST, null, null).items());

			PlaceSearchResponse beyond = region(WEST, null, cursor("40"));

			assertThat(beyond.items()).isEmpty();
			assertThat(beyond.emptyReason()).isNull();
			assertThat(beyond.nextCursor()).isNull();
			assertThat(beyond.totalCount()).isEqualTo(21);
		}

		@Test
		@DisplayName("REGION_잘못된커서는_400예외다")
		void region_invalidCursor_throws() {
			assertThatThrownBy(() -> region(WEST, null, "a=")).isInstanceOf(InvalidCursorException.class);
		}

		@Test
		@DisplayName("REGION_영역에장소가없으면_빈목록과기존emptyReason이다")
		void region_noPlaces_emptyReason() {
			PlaceSearchResponse response = region(DAEJEON, Map.of("text", "t"), null);

			assertThat(response.items()).isEmpty();
			assertThat(response.emptyReason()).isEqualTo(MockPlaceSearchEngine.EMPTY_REASON);
			assertThat(response.conditions()).containsEntry("text", "t");
		}

		@Test
		@DisplayName("REGION_empty시나리오는_커서가없거나빈문자열이면빈목록이고커서가있으면무시한다")
		void region_emptyScenario_onlyFirstPage() {
			String next = region(WEST, null, null).nextCursor();
			emptyScenario();

			assertThat(region(WEST, null, null).items()).isEmpty();
			assertThat(region(WEST, null, "").items()).isEmpty();
			assertThat(region(WEST, null, next).items()).hasSize(1);
		}

		@Test
		@DisplayName("SEARCH_질의에근처가있어도_다른질의와같은결과다")
		void search_nearQuery_sameAsOtherQuery() {
			PlaceSearchResponse near = engine.search(SearchPurpose.SEARCH,
					new PlaceSearchRequest("근처 맛집", null, null, null, null), null).response();
			PlaceSearchResponse other = engine.search(SearchPurpose.SEARCH,
					new PlaceSearchRequest("카페", null, null, null, null), null).response();

			assertThat(near.nearby()).isFalse();
			assertThat(near.items()).hasSize(20);
			assertThat(near.nextCursor()).isNotNull();
			assertThat(near.items()).isEqualTo(other.items());
		}

		String cursor(String offset) {
			return java.util.Base64.getUrlEncoder().withoutPadding()
					.encodeToString(offset.getBytes(java.nio.charset.StandardCharsets.UTF_8));
		}
	}

}
