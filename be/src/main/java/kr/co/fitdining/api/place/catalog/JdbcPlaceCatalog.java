package kr.co.fitdining.api.place.catalog;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Time;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Break;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Broadcast;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Corkage;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Menu;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Parking;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Pet;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Seat;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Subway;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest.MapBounds;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 장소 카탈로그(place-catalog V6, V7)를 JdbcClient의 SQL로 읽는 {@link PlaceCatalog} 구현. 읽기 전용이라 JPA 엔티티를
 * 만들지 않는다(place-lookup-db D-4). 응답 모양과 영업 상태 규칙은 place-catalog spec을 따른다.
 */
@Slf4j
@Component
@ConditionalOnCatalogMode
public class JdbcPlaceCatalog implements PlaceCatalog {

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
	private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
	private static final Map<DayCode, String> DAY_NAMES = Map.of(
			DayCode.MON, "월", DayCode.TUE, "화", DayCode.WED, "수", DayCode.THU, "목",
			DayCode.FRI, "금", DayCode.SAT, "토", DayCode.SUN, "일");
	private static final String NO_KIDS_ZONE = "노키즈존";
	private static final String VALET = "발렛파킹";

	private static final String PLACE_SQL = """
			SELECT place_id, name, category_group, station, lat, lng, thumbnail_url,
			       COALESCE(NULLIF(btrim(address), ''), NULLIF(btrim(full_address), ''),
			                NULLIF(btrim(jibun_address), '')) AS address, directions, description, phone, website,
			       extra_links, booking_url, facilities, parking_free, parking_note, pet_allowed, pet_note,
			       corkage_allowed, corkage_note, payment_methods
			FROM places WHERE place_id = :id""";
	private static final String HOURS_SQL = """
			SELECT day_of_week, open_time, close_time, closed, breaks, last_orders
			FROM place_hours WHERE place_id = :id""";
	private static final String MENUS_SQL = """
			SELECT category, name, description, price, price_text, labels, representative, photo_urls
			FROM place_menus WHERE place_id = :id ORDER BY sort_order""";
	private static final String PLACE_IDS_SQL = "SELECT place_id FROM places ORDER BY place_id";
	private static final String PHOTOS_SQL = """
			SELECT url FROM place_photos WHERE place_id = :id ORDER BY (source = 'menuBoard'), sort_order""";
	private static final String SUBWAYS_SQL = """
			SELECT station, line, exit, walk_minutes
			FROM place_subways WHERE place_id = :id ORDER BY walk_meters NULLS LAST, place_subway_id""";
	private static final String SEATS_SQL = """
			SELECT name, description FROM place_seats WHERE place_id = :id ORDER BY place_seat_id""";
	private static final String BROADCASTS_SQL = """
			SELECT channel, program, episode, aired_on, menu
			FROM place_broadcasts WHERE place_id = :id ORDER BY place_broadcast_id""";
	private static final String ALL_PLACES_SQL = """
			SELECT place_id, name, category_group, station, lat, lng, thumbnail_url, category
			FROM places ORDER BY place_id""";
	private static final String ALL_HOURS_SQL = """
			SELECT place_id, day_of_week, open_time, close_time, closed, breaks, last_orders FROM place_hours""";
	private static final String PLACES_BY_IDS_SQL = """
			SELECT place_id, name, category_group, station, lat, lng, thumbnail_url
			FROM places WHERE place_id IN (:ids) ORDER BY place_id""";
	private static final String HOURS_BY_IDS_SQL = """
			SELECT place_id, day_of_week, open_time, close_time, closed, breaks, last_orders
			FROM place_hours WHERE place_id IN (:ids)""";
	// 좌표와 개수는 바인딩한다. 경계도 영역 안이다(BETWEEN)
	private static final String AREA_PLACE_IDS = """
			SELECT place_id FROM places
			WHERE lat BETWEEN :swLat AND :neLat AND lng BETWEEN :swLng AND :neLng
			ORDER BY place_id LIMIT :limit""";
	private static final String AREA_PLACES_SQL = """
			SELECT place_id, name, category_group, station, lat, lng, thumbnail_url
			FROM places WHERE place_id IN (""" + AREA_PLACE_IDS + ") ORDER BY place_id";
	private static final String AREA_HOURS_SQL = """
			SELECT place_id, day_of_week, open_time, close_time, closed, breaks, last_orders
			FROM place_hours WHERE place_id IN (""" + AREA_PLACE_IDS + ")";
	private static final String ALL_MENU_NAMES_SQL = """
			SELECT place_id, name FROM place_menus ORDER BY place_id, sort_order""";

	private final JdbcClient jdbc;
	private final JsonMapper jsonMapper;
	private final Clock clock;

	public JdbcPlaceCatalog(JdbcClient jdbc, JsonMapper jsonMapper, Optional<Clock> clock) {
		this.jdbc = jdbc;
		this.jsonMapper = jsonMapper;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	@Override
	public Optional<PlaceDetailResponse> findPlace(long id) {
		return jdbc.sql(PLACE_SQL).param("id", id).query(JdbcPlaceCatalog::placeRow).optional()
				.map(row -> detail(id, row));
	}

	@Override
	public List<Long> placeIds() {
		return jdbc.sql(PLACE_IDS_SQL).query(Long.class).list();
	}

	@Override
	public List<PlaceCard> nearbyCandidates() {
		return cards(jdbc.sql(ALL_PLACES_SQL), jdbc.sql(ALL_HOURS_SQL));
	}

	@Override
	public List<PlaceCard> cards(Collection<Long> ids) {
		if (ids.isEmpty()) {
			return List.of();
		}
		return cards(jdbc.sql(PLACES_BY_IDS_SQL).param("ids", ids), jdbc.sql(HOURS_BY_IDS_SQL).param("ids", ids));
	}

	@Override
	public List<PlaceCard> cardsWithin(MapBounds area, int limit) {
		return cards(area(jdbc.sql(AREA_PLACES_SQL), area, limit), area(jdbc.sql(AREA_HOURS_SQL), area, limit));
	}

	private static JdbcClient.StatementSpec area(JdbcClient.StatementSpec spec, MapBounds area, int limit) {
		return spec.param("swLat", area.swLat()).param("swLng", area.swLng()).param("neLat", area.neLat())
				.param("neLng", area.neLng()).param("limit", limit);
	}

	/** 장소 행과 영업시간 행으로 점수 없는 카드를 만든다. 영업 상태는 지금 서울 시각 기준이다. */
	private List<PlaceCard> cards(JdbcClient.StatementSpec placesQuery, JdbcClient.StatementSpec hoursQuery) {
		List<PlaceSummary> places = placesQuery.query((rs, rowNum) -> summary(rs)).list();
		Map<Long, Map<DayCode, Hours>> hoursByPlace = new HashMap<>();
		for (PlaceHours row : hoursQuery
				.query((rs, rowNum) -> new PlaceHours(rs.getLong("place_id"), hours(rs))).list()) {
			hoursByPlace.computeIfAbsent(row.placeId(), key -> new EnumMap<>(DayCode.class))
					.put(row.hours().dayOfWeek(), row.hours());
		}
		LocalDateTime now = now();
		return places.stream()
				.map(place -> new PlaceCard(place, null, List.of(), null,
						OpenStatusCalculator.openStatus(sevenDays(hoursByPlace.getOrDefault(place.id(), Map.of())), now),
						List.of(), List.of()))
				.toList();
	}

	@Override
	public List<PlaceSearchDocument> loadSearchDocuments() {
		List<PlaceWithCategory> places = jdbc.sql(ALL_PLACES_SQL)
				.query((rs, rowNum) -> new PlaceWithCategory(summary(rs), blankToNull(rs.getString("category")))).list();
		Map<Long, List<String>> menuNames = new LinkedHashMap<>();
		for (MenuName row : jdbc.sql(ALL_MENU_NAMES_SQL)
				.query((rs, rowNum) -> new MenuName(rs.getLong("place_id"), rs.getString("name"))).list()) {
			menuNames.computeIfAbsent(row.placeId(), key -> new ArrayList<>()).add(row.name());
		}
		return places.stream()
				.map(place -> new PlaceSearchDocument(place.summary(),
						menuNames.getOrDefault(place.summary().id(), List.of()), place.category()))
				.toList();
	}

	private PlaceDetailResponse detail(long id, PlaceRow row) {
		List<Hours> hours = readHours(id);
		boolean valet = row.facilities().contains(VALET);
		return new PlaceDetailResponse(
				row.summary(),
				row.address() == null ? "" : row.address(),
				List.of(),
				jdbc.sql(PHOTOS_SQL).param("id", id).query((rs, rowNum) -> rs.getString("url")).list(),
				row.phone(),
				row.website(),
				OpenStatusCalculator.openStatus(hours, now()),
				hours,
				closedDayNote(hours),
				jdbc.sql(MENUS_SQL).param("id", id).query((rs, rowNum) -> menu(rs)).list(),
				row.facilities(),
				jdbc.sql(SUBWAYS_SQL).param("id", id).query((rs, rowNum) -> subway(rs)).list(),
				row.directions(),
				row.parkingFree() == null && row.parkingNote() == null && !valet
						? null : new Parking(row.parkingFree(), row.parkingNote(), valet),
				row.petAllowed() == null && row.petNote() == null ? null : new Pet(row.petAllowed(), row.petNote()),
				row.facilities().contains(NO_KIDS_ZONE),
				row.corkageAllowed() == null && row.corkageNote() == null
						? null : new Corkage(row.corkageAllowed(), row.corkageNote()),
				row.bookingUrl(),
				jdbc.sql(SEATS_SQL).param("id", id)
						.query((rs, rowNum) -> new Seat(rs.getString("name"), blankToNull(rs.getString("description"))))
						.list(),
				row.description(),
				row.paymentMethods(),
				jdbc.sql(BROADCASTS_SQL).param("id", id).query((rs, rowNum) -> broadcast(rs)).list(),
				row.extraLinks());
	}

	private List<Hours> readHours(long id) {
		Map<DayCode, Hours> byDay = new EnumMap<>(DayCode.class);
		jdbc.sql(HOURS_SQL).param("id", id).query((rs, rowNum) -> hours(rs)).list()
				.forEach(hours -> byDay.put(hours.dayOfWeek(), hours));
		return sevenDays(byDay);
	}

	/** 월~일 7개. 행이 없는 요일은 영업시간 정보 없음(휴무 아님, 시각 없음)이다. */
	private static List<Hours> sevenDays(Map<DayCode, Hours> byDay) {
		return Arrays.stream(DayCode.values())
				.map(day -> byDay.getOrDefault(day, new Hours(day, null, null, List.of(), List.of(), false)))
				.toList();
	}

	/** 정기휴무 요일을 월요일부터 세어 "매주 토·일요일 휴무"로 만든다. 정기휴무가 없으면 null이다. */
	static String closedDayNote(List<Hours> hours) {
		List<String> days = hours.stream()
				.filter(day -> Boolean.TRUE.equals(day.closed()))
				.map(day -> DAY_NAMES.get(day.dayOfWeek()))
				.toList();
		return days.isEmpty() ? null : "매주 " + String.join("·", days) + "요일 휴무";
	}

	private LocalDateTime now() {
		return LocalDateTime.now(clock.withZone(SEOUL));
	}

	private Hours hours(ResultSet rs) throws SQLException {
		LocalTime open = rs.getObject("open_time", LocalTime.class);
		LocalTime close = rs.getObject("close_time", LocalTime.class);
		String breaks = rs.getString("breaks");
		return new Hours(DayCode.valueOf(rs.getString("day_of_week")),
				open == null ? null : HH_MM.format(open),
				close == null ? null : HH_MM.format(close),
				breaks(breaks),
				times(rs, "last_orders"),
				rs.getBoolean("closed"));
	}

	/**
	 * 브레이크 목록(jsonb)을 읽는다. 스키마는 원소의 모양을 정하지 않으므로 시작과 끝이 시각인 항목만 받고 나머지는
	 * 버린다. 알 수 없는 속성은 무시한다. 한 곳의 깨진 값이 그 장소의 상세와 첫 화면 주변 카드 전체를 무너뜨리지 않게 한다.
	 */
	private List<Break> breaks(String json) {
		if (json == null || json.isBlank()) {
			return List.of();
		}
		JsonNode root;
		try {
			root = jsonMapper.readTree(json);
		} catch (JacksonException e) {
			log.warn("Ignored unreadable place_hours.breaks");
			return List.of();
		}
		List<Break> breaks = new ArrayList<>();
		for (JsonNode node : root) {
			String start = time(node.get("start"));
			String end = time(node.get("end"));
			if (start != null && end != null) {
				breaks.add(new Break(start, end));
			}
		}
		return breaks;
	}

	private static String time(JsonNode node) {
		if (node == null || !node.isString()) {
			return null;
		}
		try {
			LocalTime.parse(node.asString());
			return node.asString();
		} catch (DateTimeParseException e) {
			return null;
		}
	}

	private static PlaceSummary summary(ResultSet rs) throws SQLException {
		return new PlaceSummary(rs.getLong("place_id"), rs.getString("name"),
				CategoryGroup.valueOf(rs.getString("category_group")), station(rs),
				rs.getDouble("lat"), rs.getDouble("lng"), blankToNull(rs.getString("thumbnail_url")));
	}

	/** 가까운 역이 없는 장소는 null이다(places.station이 NULL). */
	private static Station station(ResultSet rs) throws SQLException {
		String code = rs.getString("station");
		return code == null ? null : Station.valueOf(code);
	}

	private static PlaceRow placeRow(ResultSet rs, int rowNum) throws SQLException {
		return new PlaceRow(summary(rs), blankToNull(rs.getString("address")),
				blankToNull(rs.getString("directions")), blankToNull(rs.getString("description")),
				blankToNull(rs.getString("phone")), blankToNull(rs.getString("website")),
				strings(rs, "extra_links"), blankToNull(rs.getString("booking_url")), strings(rs, "facilities"),
				rs.getObject("parking_free", Boolean.class), blankToNull(rs.getString("parking_note")),
				rs.getObject("pet_allowed", Boolean.class), blankToNull(rs.getString("pet_note")),
				rs.getObject("corkage_allowed", Boolean.class), blankToNull(rs.getString("corkage_note")),
				strings(rs, "payment_methods"));
	}

	private static Menu menu(ResultSet rs) throws SQLException {
		List<String> photoUrls = strings(rs, "photo_urls");
		return new Menu(blankToNull(rs.getString("category")), rs.getString("name"),
				blankToNull(rs.getString("description")), rs.getObject("price", Integer.class),
				blankToNull(rs.getString("price_text")), strings(rs, "labels"), rs.getBoolean("representative"),
				photoUrls.isEmpty() ? null : photoUrls.get(0));
	}

	private static Subway subway(ResultSet rs) throws SQLException {
		return new Subway(rs.getString("station"), blankToNull(rs.getString("line")),
				blankToNull(rs.getString("exit")), rs.getObject("walk_minutes", Integer.class));
	}

	private static Broadcast broadcast(ResultSet rs) throws SQLException {
		LocalDate airedOn = rs.getObject("aired_on", LocalDate.class);
		return new Broadcast(blankToNull(rs.getString("channel")), blankToNull(rs.getString("program")),
				blankToNull(rs.getString("episode")), airedOn == null ? null : airedOn.toString(),
				blankToNull(rs.getString("menu")));
	}

	private static List<String> strings(ResultSet rs, String column) throws SQLException {
		Array array = rs.getArray(column);
		if (array == null) {
			return List.of();
		}
		return Arrays.stream((Object[]) array.getArray()).filter(Objects::nonNull).map(Object::toString).toList();
	}

	private static List<String> times(ResultSet rs, String column) throws SQLException {
		Array array = rs.getArray(column);
		if (array == null) {
			return List.of();
		}
		return Arrays.stream((Object[]) array.getArray()).filter(Objects::nonNull)
				.map(value -> HH_MM.format(((Time) value).toLocalTime())).toList();
	}

	private static String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value;
	}

	private record PlaceRow(PlaceSummary summary, String address, String directions, String description, String phone,
			String website, List<String> extraLinks, String bookingUrl, List<String> facilities, Boolean parkingFree,
			String parkingNote, Boolean petAllowed, String petNote, Boolean corkageAllowed, String corkageNote,
			List<String> paymentMethods) {
	}

	private record PlaceHours(long placeId, Hours hours) {
	}

	private record PlaceWithCategory(PlaceSummary summary, String category) {
	}

	private record MenuName(long placeId, String name) {
	}

}
