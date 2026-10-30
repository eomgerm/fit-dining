package kr.co.fitdining.api.place.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Break;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** 실제 Postgres(마이그레이션 적용)에 시드한 행으로 {@link JdbcPlaceCatalog}의 읽기와 변환을 확인한다. */
class JdbcPlaceCatalogTest extends PostgresTestSupport {

	/** 2026-10-21(수) 12:00 KST. */
	private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneId.of("Asia/Seoul"));

	private static JdbcTemplate jdbc;

	private JdbcPlaceCatalog catalog;

	@BeforeAll
	static void migrateOnce() throws Exception {
		migrate();
		jdbc = new JdbcTemplate(appSource());
	}

	@BeforeEach
	void setUp() {
		// 자식 테이블은 ON DELETE CASCADE다. 다른 테스트의 행이 남아 있어도 이 테스트는 자기 행만 본다.
		jdbc.update("DELETE FROM places");
		catalog = new JdbcPlaceCatalog(JdbcClient.create(appSource()), JsonMapper.builder().build(),
				Optional.of(CLOCK));
	}

	private long place(String name, String group, String station) {
		return jdbc.queryForObject("""
				INSERT INTO places (naver_place_id, name, category_group, station, lat, lng)
				VALUES (?, ?, ?, ?, 37.5, 127.03) RETURNING place_id""", Long.class,
				UUID.randomUUID().toString(), name, group, station);
	}

	private void hours(long placeId, String day, String open, String close, boolean closed, String breaksJson,
			String lastOrders) {
		jdbc.update("""
				INSERT INTO place_hours (place_id, day_of_week, open_time, close_time, closed, breaks, last_orders)
				VALUES (?, ?, ?::time, ?::time, ?, ?::jsonb, ?::time[])""",
				placeId, day, open, close, closed, breaksJson, lastOrders);
	}

	@Test
	@DisplayName("장소상세_없는id는_빈값이다")
	void findPlace_unknownId_returnsEmpty() {
		assertThat(catalog.findPlace(-1)).isEmpty();
	}

	@Test
	@DisplayName("장소상세_필수열만있는장소는_빈값과기본값으로채운다")
	void findPlace_onlyRequiredColumns_fillsEmptyDefaults() {
		long id = place("카페 온담", "CAFE", "YEOKSAM");

		PlaceDetailResponse detail = catalog.findPlace(id).orElseThrow();

		assertThat(detail.place().id()).isEqualTo(id);
		assertThat(detail.place().name()).isEqualTo("카페 온담");
		assertThat(detail.place().categoryGroup()).isEqualTo(CategoryGroup.CAFE);
		assertThat(detail.place().station()).isEqualTo(Station.YEOKSAM);
		assertThat(detail.place().lat()).isEqualTo(37.5);
		assertThat(detail.place().thumbnailUrl()).isNull();
		assertThat(detail.address()).isEmpty();
		assertThat(detail.tags()).isEmpty();
		assertThat(detail.photos()).isEmpty();
		assertThat(detail.menus()).isEmpty();
		assertThat(detail.facilities()).isEmpty();
		assertThat(detail.subways()).isEmpty();
		assertThat(detail.seats()).isEmpty();
		assertThat(detail.broadcasts()).isEmpty();
		assertThat(detail.paymentMethods()).isEmpty();
		assertThat(detail.extraLinks()).isEmpty();
		assertThat(detail.hours()).hasSize(7);
		assertThat(detail.hours()).extracting(Hours::dayOfWeek).containsExactly(DayCode.values());
		assertThat(detail.hours()).allSatisfy(day -> {
			assertThat(day.closed()).isFalse();
			assertThat(day.open()).isNull();
			assertThat(day.close()).isNull();
			assertThat(day.breaks()).isEmpty();
			assertThat(day.lastOrders()).isEmpty();
		});
		assertThat(detail.openStatus()).isEqualTo(OpenStatus.UNKNOWN);
		assertThat(detail.closedDayNote()).isNull();
		assertThat(detail.noKidsZone()).isFalse();
		assertThat(detail.parking()).isNull();
		assertThat(detail.pet()).isNull();
		assertThat(detail.corkage()).isNull();
		assertThat(detail.phone()).isNull();
		assertThat(detail.website()).isNull();
		assertThat(detail.directions()).isNull();
		assertThat(detail.description()).isNull();
		assertThat(detail.bookingUrl()).isNull();
	}

	@Test
	@DisplayName("장소상세_값이있는열은_그대로옮기고시설에서플래그를정한다")
	void findPlace_filledColumns_copiesValuesAndDerivesFlags() {
		long id = place("야마야", "RESTAURANT", "GANGNAM");
		jdbc.update("""
				UPDATE places SET address = '서울 강남구 1', thumbnail_url = 'https://t.example/1.jpg',
				    phone = '02-000-0000', website = 'https://w.example', booking_url = 'https://b.example',
				    description = '소개', directions = '1번 출구',
				    facilities = '{무선 인터넷,노키즈존,발렛파킹}'::text[], payment_methods = '{카드,현금}'::text[],
				    extra_links = '{https://a.example}'::text[], pet_allowed = TRUE, pet_note = '소형견만'
				WHERE place_id = ?""", id);

		PlaceDetailResponse detail = catalog.findPlace(id).orElseThrow();

		assertThat(detail.address()).isEqualTo("서울 강남구 1");
		assertThat(detail.place().thumbnailUrl()).isEqualTo("https://t.example/1.jpg");
		assertThat(detail.phone()).isEqualTo("02-000-0000");
		assertThat(detail.website()).isEqualTo("https://w.example");
		assertThat(detail.bookingUrl()).isEqualTo("https://b.example");
		assertThat(detail.description()).isEqualTo("소개");
		assertThat(detail.directions()).isEqualTo("1번 출구");
		assertThat(detail.facilities()).containsExactly("무선 인터넷", "노키즈존", "발렛파킹");
		assertThat(detail.paymentMethods()).containsExactly("카드", "현금");
		assertThat(detail.extraLinks()).containsExactly("https://a.example");
		assertThat(detail.noKidsZone()).isTrue();
		// 주차: 무료 여부와 안내가 없고 발렛만 있다.
		assertThat(detail.parking()).isNotNull();
		assertThat(detail.parking().free()).isNull();
		assertThat(detail.parking().note()).isNull();
		assertThat(detail.parking().valet()).isTrue();
		assertThat(detail.pet().allowed()).isTrue();
		assertThat(detail.pet().note()).isEqualTo("소형견만");
		assertThat(detail.corkage()).isNull();
	}

	@Test
	@DisplayName("장소상세_사진은업체사진다음메뉴판사진이고각각sort_order순이다")
	void findPlace_photos_businessThenMenuBoardEachInOrder() {
		long id = place("사진 가게", "CAFE", "GANGNAM");
		jdbc.update("""
				INSERT INTO place_photos (place_id, source, sort_order, url)
				VALUES (?, 'menuBoard', 0, 'm0'), (?, 'business', 1, 'b1'), (?, 'business', 0, 'b0')""",
				id, id, id);

		assertThat(catalog.findPlace(id).orElseThrow().photos()).containsExactly("b0", "b1", "m0");
	}

	@Test
	@DisplayName("장소상세_메뉴는sort_order순이고숫자없는가격과첫사진을옮긴다")
	void findPlace_menus_inOrderWithPriceTextAndFirstPhoto() {
		long id = place("메뉴 가게", "RESTAURANT", "GANGNAM");
		jdbc.update("""
				INSERT INTO place_menus (place_id, sort_order, category, name, price, price_text, representative,
				    labels, photo_urls)
				VALUES (?, 1, NULL, '치즈케이크', NULL, '가격 변동', false, '{사전예약}'::text[], '{}'::text[]),
				       (?, 0, '커피', '아메리카노', 4500, '4,500원', true, '{}'::text[], '{u1,u2}'::text[])""", id, id);

		List<PlaceDetailResponse.Menu> menus = catalog.findPlace(id).orElseThrow().menus();

		assertThat(menus).extracting(PlaceDetailResponse.Menu::name).containsExactly("아메리카노", "치즈케이크");
		assertThat(menus.get(0).category()).isEqualTo("커피");
		assertThat(menus.get(0).price()).isEqualTo(4500);
		assertThat(menus.get(0).priceText()).isEqualTo("4,500원");
		assertThat(menus.get(0).representative()).isTrue();
		assertThat(menus.get(0).photoUrl()).isEqualTo("u1");
		assertThat(menus.get(1).category()).isNull();
		assertThat(menus.get(1).price()).isNull();
		assertThat(menus.get(1).priceText()).isEqualTo("가격 변동");
		assertThat(menus.get(1).labels()).containsExactly("사전예약");
		assertThat(menus.get(1).photoUrl()).isNull();
	}

	@Test
	@DisplayName("장소상세_지하철은도보거리순이고거리가없으면뒤로간다")
	void findPlace_subways_byWalkDistanceNullsLast() {
		long id = place("역 근처", "CAFE", "GANGNAM");
		jdbc.update("""
				INSERT INTO place_subways (place_id, station, line, exit, walk_minutes, walk_meters)
				VALUES (?, 'A', '2', '1번', 4, 300), (?, 'B', NULL, NULL, NULL, NULL), (?, 'C', '신분당', NULL, 2, 100)""",
				id, id, id);

		List<PlaceDetailResponse.Subway> subways = catalog.findPlace(id).orElseThrow().subways();

		assertThat(subways).extracting(PlaceDetailResponse.Subway::station).containsExactly("C", "A", "B");
		assertThat(subways.get(0).line()).isEqualTo("신분당");
		assertThat(subways.get(1).exit()).isEqualTo("1번");
		assertThat(subways.get(1).walkMinutes()).isEqualTo(4);
		assertThat(subways.get(2).walkMinutes()).isNull();
	}

	@Test
	@DisplayName("장소상세_좌석과방송은옮기고방송일은문자열이다")
	void findPlace_seatsAndBroadcasts_mapped() {
		long id = place("방송 맛집", "RESTAURANT", "SEOLLEUNG");
		jdbc.update("INSERT INTO place_seats (place_id, name, description) VALUES (?, '단체석', NULL), (?, '바', '6석')",
				id, id);
		jdbc.update("""
				INSERT INTO place_broadcasts (place_id, channel, program, episode, aired_on, menu)
				VALUES (?, 'KBS', '생생정보', '12회', DATE '2024-03-05', '곱창')""", id);

		PlaceDetailResponse detail = catalog.findPlace(id).orElseThrow();

		assertThat(detail.seats()).extracting(PlaceDetailResponse.Seat::name).containsExactly("단체석", "바");
		assertThat(detail.seats().get(0).description()).isNull();
		assertThat(detail.broadcasts()).hasSize(1);
		assertThat(detail.broadcasts().get(0).airedOn()).isEqualTo("2024-03-05");
		assertThat(detail.broadcasts().get(0).menu()).isEqualTo("곱창");
	}

	@Test
	@DisplayName("장소상세_영업시간은7요일이고브레이크와라스트오더와자정넘김을옮기며정기휴무를안내한다")
	void findPlace_hours_mapsBreaksLastOrdersMidnightAndClosedDays() {
		long id = place("야간 식당", "RESTAURANT", "GANGNAM");
		hours(id, "TUE", null, null, true, "[]", "{}");
		hours(id, "WED", "18:00", "02:00", false, "[{\"start\":\"22:00\",\"end\":\"23:00\"}]", "{01:30}");
		hours(id, "THU", null, null, true, "[]", "{}");
		hours(id, "FRI", "00:00", "00:00", false, "[]", "{}");

		PlaceDetailResponse detail = catalog.findPlace(id).orElseThrow();

		assertThat(detail.hours()).extracting(Hours::dayOfWeek).containsExactly(DayCode.values());
		assertThat(detail.hours().get(1).closed()).isTrue();
		Hours wednesday = detail.hours().get(2);
		assertThat(wednesday.open()).isEqualTo("18:00");
		assertThat(wednesday.close()).isEqualTo("02:00");
		assertThat(wednesday.breaks()).containsExactly(new Break("22:00", "23:00"));
		assertThat(wednesday.lastOrders()).containsExactly("01:30");
		assertThat(detail.hours().get(4).open()).isEqualTo("00:00");
		assertThat(detail.hours().get(4).close()).isEqualTo("00:00");
		// 날짜 없는 정기휴무만 안내하고, 행이 없는 요일(정보 없음)은 포함하지 않는다.
		assertThat(detail.closedDayNote()).isEqualTo("매주 화·목요일 휴무");
		// 수요일 12:00은 18:00 개점 전이고 어제(화)는 휴무라 CLOSED다.
		assertThat(detail.openStatus()).isEqualTo(OpenStatus.CLOSED);
	}

	@Test
	@DisplayName("장소상세_영업시간안이면_서울시각기준으로OPEN이다")
	void findPlace_insideHours_openAtSeoulTime() {
		long id = place("낮 식당", "RESTAURANT", "GANGNAM");
		hours(id, "WED", "11:00", "22:00", false, "[]", "{}");

		assertThat(catalog.findPlace(id).orElseThrow().openStatus()).isEqualTo(OpenStatus.OPEN);
	}

	@Test
	@DisplayName("주변후보_카탈로그전체를id순으로돌려주고점수와이유는비어있다")
	void nearbyCandidates_everyPlace_inIdOrderWithoutScore() {
		long first = place("가", "CAFE", "GANGNAM");
		long second = place("나", "BAR", "SEOLLEUNG");
		hours(second, "WED", "11:00", "22:00", false, "[]", "{}");

		List<PlaceCard> cards = catalog.nearbyCandidates();

		assertThat(cards).extracting(card -> card.place().id()).containsExactly(first, second);
		assertThat(cards).allSatisfy(card -> {
			assertThat(card.score()).isNull();
			assertThat(card.caution()).isNull();
			assertThat(card.labels()).isEmpty();
			assertThat(card.reasons()).isEmpty();
			assertThat(card.scoreItems()).isEmpty();
		});
		assertThat(cards.get(0).openStatus()).isEqualTo(OpenStatus.UNKNOWN);
		assertThat(cards.get(1).openStatus()).isEqualTo(OpenStatus.OPEN);
		assertThat(cards.get(1).place().categoryGroup()).isEqualTo(CategoryGroup.BAR);
		assertThat(cards.get(1).place().station()).isEqualTo(Station.SEOLLEUNG);
	}

	@Test
	@DisplayName("id로카드읽기_있는id만한번에읽고점수와이유는비어있다")
	void cards_byIds_readsKnownOnlyWithoutScore() {
		long first = place("가", "CAFE", "GANGNAM");
		long second = place("나", "BAR", "SEOLLEUNG");
		long other = place("다", "CAFE", "YEOKSAM");
		hours(second, "WED", "11:00", "22:00", false, "[]", "{}");

		List<PlaceCard> cards = catalog.cards(List.of(second, -1L, first));

		assertThat(cards).extracting(card -> card.place().id()).containsExactlyInAnyOrder(first, second)
				.doesNotContain(other);
		assertThat(cards).allSatisfy(card -> {
			assertThat(card.score()).isNull();
			assertThat(card.caution()).isNull();
			assertThat(card.labels()).isEmpty();
			assertThat(card.reasons()).isEmpty();
			assertThat(card.scoreItems()).isEmpty();
		});
		PlaceCard bar = cards.stream().filter(card -> card.place().id() == second).findFirst().orElseThrow();
		assertThat(bar.openStatus()).isEqualTo(OpenStatus.OPEN);
		assertThat(bar.place().name()).isEqualTo("나");
		assertThat(bar.place().categoryGroup()).isEqualTo(CategoryGroup.BAR);
		assertThat(bar.place().station()).isEqualTo(Station.SEOLLEUNG);
		assertThat(bar.place().lat()).isEqualTo(37.5);
	}

	@Test
	@DisplayName("id로카드읽기_빈목록이면_DB를보지않고빈목록이다")
	void cards_emptyIds_returnsEmpty() {
		place("가", "CAFE", "GANGNAM");

		assertThat(catalog.cards(List.of())).isEmpty();
	}

	@Test
	@DisplayName("검색문서_메뉴는원본순서이고네이버업종과메뉴없는장소를옮긴다")
	void loadSearchDocuments_menusInOrderAndNaverCategory() {
		long first = place("베트남집", "RESTAURANT", "YEOKSAM");
		long second = place("빈 가게", "CAFE", "GANGNAM");
		jdbc.update("UPDATE places SET category = '베트남음식' WHERE place_id = ?", first);
		jdbc.update("""
				INSERT INTO place_menus (place_id, sort_order, name) VALUES (?, 1, 'B'), (?, 0, 'A')""", first, first);

		List<PlaceSearchDocument> documents = catalog.loadSearchDocuments();

		assertThat(documents).extracting(document -> document.place().id()).containsExactly(first, second);
		assertThat(documents.get(0).menuNames()).containsExactly("A", "B");
		assertThat(documents.get(0).naverCategory()).isEqualTo("베트남음식");
		assertThat(documents.get(1).menuNames()).isEmpty();
		assertThat(documents.get(1).naverCategory()).isNull();
	}


	@Test
	@DisplayName("장소상세_깨진브레이크는그것만버리고_나머지와다른장소는그대로읽는다")
	void findPlace_malformedBreaks_dropsOnlyThoseEntries() {
		// 앱의 JSON 설정처럼 알 수 없는 속성을 거부하는 매퍼로 읽는다.
		JdbcPlaceCatalog strict = new JdbcPlaceCatalog(JdbcClient.create(appSource()),
				JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build(), Optional.of(CLOCK));
		long broken = place("깨진 시간표", "RESTAURANT", "GANGNAM");
		long healthy = place("멀쩡한 가게", "RESTAURANT", "GANGNAM");
		hours(broken, "WED", "11:00", "22:00", false,
				"[{\"start\":\"15:00\"},{\"start\":\"16:00\",\"end\":\"17:00\",\"seq\":1},{\"end\":\"09:00\"},"
						+ "\"junk\",{\"start\":\"x\",\"end\":\"y\"}]", "{}");
		hours(healthy, "WED", "11:00", "22:00", false, "[]", "{}");

		// 끝이 없거나 시각이 아닌 항목은 버리고, 알 수 없는 속성이 붙은 항목은 읽는다.
		assertThat(strict.findPlace(broken).orElseThrow().hours().get(2).breaks())
				.containsExactly(new Break("16:00", "17:00"));
		// 한 곳의 깨진 값이 첫 화면 주변 카드 전체를 무너뜨리지 않는다.
		assertThat(strict.nearbyCandidates()).extracting(card -> card.place().id()).containsExactly(broken, healthy);
	}

	@Test
	@DisplayName("장소상세_주소가빈문자열이면_다음주소로대신한다")
	void findPlace_blankAddress_fallsBackToNextAddress() {
		long id = place("주소 가게", "CAFE", "GANGNAM");
		jdbc.update("UPDATE places SET address = '', full_address = '서울 강남구 풀주소' WHERE place_id = ?", id);

		assertThat(catalog.findPlace(id).orElseThrow().address()).isEqualTo("서울 강남구 풀주소");
	}

	@Test
	@DisplayName("장소상세_시계가UTC여도_서울시각으로영업상태를계산한다")
	void findPlace_utcClock_usesSeoulTime() {
		// 2026-10-21T03:00Z는 서울 12:00이다. UTC 그대로 03:00으로 계산하면 개점 전이라 CLOSED다.
		JdbcPlaceCatalog utc = new JdbcPlaceCatalog(JdbcClient.create(appSource()), JsonMapper.builder().build(),
				Optional.of(Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneOffset.UTC)));
		long id = place("낮 식당", "RESTAURANT", "GANGNAM");
		hours(id, "WED", "11:00", "22:00", false, "[]", "{}");

		assertThat(utc.findPlace(id).orElseThrow().openStatus()).isEqualTo(OpenStatus.OPEN);
		assertThat(utc.nearbyCandidates().get(0).openStatus()).isEqualTo(OpenStatus.OPEN);
	}

	@Test
	@DisplayName("장소상세_거리가같은지하철은_원본순서인PK순이다")
	void findPlace_subwaysWithSameDistance_inPrimaryKeyOrder() {
		long id = place("역 가게", "CAFE", "GANGNAM");
		jdbc.update("""
				INSERT INTO place_subways (place_id, station, walk_minutes, walk_meters)
				VALUES (?, '둘째로넣음', 2, 100), (?, '첫째로넣음', 2, 100)""", id, id);
		// 먼저 넣은 행(PK가 작은 행)의 인덱스 열을 바꿨다 되돌리면 새 튜플과 새 인덱스 항목이 뒤에 붙어, 읽히는 순서가
		// PK 순서와 달라진다. 그래도 PK 순이어야 한다.
		jdbc.update("UPDATE place_subways SET walk_meters = 101 WHERE place_id = ? AND station = '둘째로넣음'", id);
		jdbc.update("UPDATE place_subways SET walk_meters = 100 WHERE place_id = ? AND station = '둘째로넣음'", id);

		assertThat(catalog.findPlace(id).orElseThrow().subways()).extracting(PlaceDetailResponse.Subway::station)
				.containsExactly("둘째로넣음", "첫째로넣음");
	}

	@Test
	@DisplayName("장소상세_주차와콜키지의값은그대로옮긴다")
	void findPlace_parkingAndCorkage_mapped() {
		long id = place("정책 가게", "BAR", "SEOLLEUNG");
		jdbc.update("""
				UPDATE places SET parking_free = FALSE, parking_note = '2시간 무료', corkage_allowed = TRUE,
				    corkage_note = '병당 2만원' WHERE place_id = ?""", id);

		PlaceDetailResponse detail = catalog.findPlace(id).orElseThrow();

		assertThat(detail.parking().free()).isFalse();
		assertThat(detail.parking().note()).isEqualTo("2시간 무료");
		assertThat(detail.parking().valet()).isFalse();
		assertThat(detail.corkage().allowed()).isTrue();
		assertThat(detail.corkage().note()).isEqualTo("병당 2만원");
	}

	@Test
	@DisplayName("목록읽기_행의물리적순서가바뀌어도_place_id오름차순이다")
	void listReads_afterRowsAreRewritten_stayInPlaceIdOrder() {
		long first = place("가", "CAFE", "GANGNAM");
		long second = place("나", "CAFE", "GANGNAM");
		long third = place("다", "CAFE", "GANGNAM");
		// UPDATE는 새 행 버전을 뒤에 쓴다. ORDER BY가 없으면 첫 장소가 마지막에 읽힌다.
		jdbc.update("UPDATE places SET name = name || '' WHERE place_id = ?", first);

		assertThat(catalog.nearbyCandidates()).extracting(card -> card.place().id())
				.containsExactly(first, second, third);
		assertThat(catalog.loadSearchDocuments()).extracting(document -> document.place().id())
				.containsExactly(first, second, third);
	}

}
