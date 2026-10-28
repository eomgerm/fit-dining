package kr.co.fitdining.api.place.engine;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceCard;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.DayCode;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Hours;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse.Menu;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSearchRequest;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse.EmptyReason;
import kr.co.fitdining.api.place.dto.PlaceSearchResponse;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse.SuggestType;
import kr.co.fitdining.api.place.dto.PlaceSuggestResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code classpath:mock/places.json}의 고정 데이터로 응답하는 개발용 엔진. local과 dev에서만
 * {@code place.mock.enabled}로 켠다(D-63).
 */
@Component
@ConditionalOnBooleanProperty("place.mock.enabled")
public class MockPlaceSearchEngine implements PlaceSearchEngine {

	static final String ACTION_LABEL = "이 조건으로 추천받기";
	static final int SUGGEST_LIMIT = 5;
	static final int PAGE_SIZE = 20;
	static final int NEARBY_LIMIT = 100;
	static final int CLOSING_SOON_MINUTES = 60;
	private static final int DAY_MINUTES = 24 * 60;
	static final String NEARBY_KEYWORD = "근처";
	static final String SCENARIO_HEADER = "X-Mock-Scenario";
	static final String EMPTY_SCENARIO = "empty";
	static final String CHANGE_SUMMARY = "요청하신 조건을 반영했어요";
	static final EmptyReason EMPTY_REASON = new EmptyReason(
			"요청하신 조건에 맞는 장소를 찾지 못했어요",
			"지역을 넓히거나 조건을 하나 빼고 다시 검색해 보세요");

	private static final Pattern OFFSET_PATTERN = Pattern.compile("0|[1-9][0-9]*");

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
	private static final Map<CategoryGroup, String> CATEGORY_NAMES = Map.of(
			CategoryGroup.RESTAURANT, "식당",
			CategoryGroup.CAFE, "카페",
			CategoryGroup.BAR, "술집");

	private final List<MockPlace> places;
	private final Clock clock;

	public MockPlaceSearchEngine(JsonMapper jsonMapper, Optional<Clock> clock) {
		this.places = load(jsonMapper);
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	@Override
	public List<PlaceSuggestResponse> suggest(String q) {
		String needle = q.strip().toLowerCase(Locale.ROOT);
		List<PlaceSuggestResponse> prefixMatches = new ArrayList<>();
		List<PlaceSuggestResponse> containsMatches = new ArrayList<>();
		for (MockPlace place : places) {
			String name = lower(place.card().place().name());
			if (name.startsWith(needle)) {
				prefixMatches.add(placeSuggestion(place, null));
			} else if (name.contains(needle)) {
				containsMatches.add(placeSuggestion(place, null));
			} else {
				String matchedMenu = firstMatchingMenu(place, needle);
				if (matchedMenu != null || matchesCategory(place, needle)) {
					containsMatches.add(placeSuggestion(place, matchedMenu));
				}
			}
		}

		List<PlaceSuggestResponse> suggestions = new ArrayList<>(prefixMatches);
		suggestions.addAll(containsMatches);
		suggestions = new ArrayList<>(suggestions.subList(0, Math.min(SUGGEST_LIMIT, suggestions.size())));
		PlaceSuggestResponse action = new PlaceSuggestResponse(SuggestType.ACTION, null, null, ACTION_LABEL);
		if (prefixMatches.isEmpty()) {
			suggestions.addFirst(action);
		} else {
			suggestions.addLast(action);
		}
		return suggestions;
	}

	@Override
	public PlaceSearchResponse search(PlaceSearchRequest request) {
		Map<String, Object> previousConditions = request.previousConditions();
		Map<String, Object> conditions = previousConditions != null ? previousConditions : Map.of();
		List<PlaceCard> ranked = rankedCards();

		// 커서가 있으면 질의, 헤더, "근처"를 무시하고 오프셋만 따른다.
		if (request.cursor() != null && !request.cursor().isEmpty()) {
			int offset = decodeCursor(request.cursor());
			return new PlaceSearchResponse(conditions, false, ranked.size(), page(ranked, offset), nextCursor(ranked, offset),
					null, null);
		}

		String changeSummary = previousConditions != null ? CHANGE_SUMMARY : null;
		if (isEmptyScenario()) {
			return new PlaceSearchResponse(conditions, false, 0, List.of(), null, EMPTY_REASON, changeSummary);
		}
		if (request.query().contains(NEARBY_KEYWORD)) {
			List<PlaceCard> candidates = ranked.subList(0, Math.min(NEARBY_LIMIT, ranked.size()));
			return new PlaceSearchResponse(conditions, true, ranked.size(), candidates, null, null, changeSummary);
		}
		return new PlaceSearchResponse(conditions, false, ranked.size(), page(ranked, 0), nextCursor(ranked, 0), null,
				changeSummary);
	}

	@Override
	public Optional<PlaceDetailResponse> findPlace(long id) {
		LocalDateTime now = now();
		return places.stream()
				.filter(place -> place.detail().place().id() == id)
				.findFirst()
				.map(place -> withOpenStatus(place.detail(), openStatus(place.detail().hours(), now)));
	}

	/** 점수 내림차순, 같으면 파일 순서다. */
	private List<PlaceCard> rankedCards() {
		LocalDateTime now = now();
		return places.stream()
				.sorted(Comparator.comparing((MockPlace place) -> place.card().score()).reversed())
				.map(place -> withOpenStatus(place.card(), openStatus(place.detail().hours(), now)))
				.toList();
	}

	private LocalDateTime now() {
		return LocalDateTime.now(clock.withZone(SEOUL));
	}

	/**
	 * 영업 상태 규칙(place-catalog spec)을 따른다. 요일 d의 영업 구간은 d의 open부터 close까지이고, close가 open과 같거나
	 * 이르면 다음 날 close까지다. 구간은 시작 포함, 끝 제외이고, 끝이 다음 요일 구간의 시작과 같으면 한 구간으로 잇는다.
	 * 브레이크 시작 전은 곧 마감으로 보지 않는다. 시각은 모두 오늘 0시부터의 분으로 계산한다.
	 */
	static OpenStatus openStatus(List<Hours> hours, LocalDateTime now) {
		int today = now.getDayOfWeek().ordinal();
		int minute = now.getHour() * 60 + now.getMinute();
		for (int offset = -1; offset <= 0; offset++) {
			Interval interval = interval(hours, today + offset, offset);
			if (interval != null && minute >= interval.start() && minute < interval.end()) {
				if (interval.breaks().stream().anyMatch(b -> minute >= b.start() && minute < b.end())) {
					return OpenStatus.BREAK;
				}
				int end = mergedEnd(hours, today + offset, offset, interval.end());
				return minute >= end - CLOSING_SOON_MINUTES ? OpenStatus.CLOSING_SOON : OpenStatus.OPEN;
			}
		}
		Hours todayHours = day(hours, today);
		if (isUnknown(todayHours)) {
			return OpenStatus.UNKNOWN;
		}
		Interval todayInterval = interval(hours, today, 0);
		if (todayInterval != null && minute < todayInterval.start() && isUnknown(day(hours, today - 1))) {
			return OpenStatus.UNKNOWN;
		}
		return OpenStatus.CLOSED;
	}

	/** 끝이 다음 요일 구간의 시작과 같은 동안 잇는다. 7일 내내 이어지면 일주일 뒤에서 멈춘다. */
	private static int mergedEnd(List<Hours> hours, int dayIndex, int offset, int end) {
		for (int next = 1; next <= DayCode.values().length; next++) {
			Interval following = interval(hours, dayIndex + next, offset + next);
			if (following == null || following.start() != end) {
				break;
			}
			end = following.end();
		}
		return end;
	}

	/** dayIndex 요일의 영업 구간을 오늘 0시 기준 분으로. offset은 오늘과의 날짜 차이다. 영업 시각이 없으면 null. */
	private static Interval interval(List<Hours> hours, int dayIndex, int offset) {
		Hours day = day(hours, dayIndex);
		if (day == null || Boolean.TRUE.equals(day.closed()) || day.open() == null || day.close() == null) {
			return null;
		}
		int base = offset * DAY_MINUTES;
		int open = minutes(day.open());
		int close = minutes(day.close());
		List<Span> breaks = day.breaks() == null ? List.of() : day.breaks().stream()
				.map(b -> {
					int start = base + minutes(b.start()) + (minutes(b.start()) < open ? DAY_MINUTES : 0);
					int end = base + minutes(b.end()) + (minutes(b.end()) < open ? DAY_MINUTES : 0);
					return new Span(start, end > start ? end : end + DAY_MINUTES);
				})
				.toList();
		return new Interval(base + open, base + (close > open ? close : close + DAY_MINUTES), breaks);
	}

	private static Hours day(List<Hours> hours, int dayIndex) {
		DayCode code = DayCode.values()[Math.floorMod(dayIndex, DayCode.values().length)];
		return hours.stream().filter(h -> h.dayOfWeek() == code).findFirst().orElse(null);
	}

	/** 휴무가 아닌데 영업 시각이 없으면 정보 없음이다. 요일 줄이 없어도 정보 없음이다. */
	private static boolean isUnknown(Hours day) {
		return day == null || (!Boolean.TRUE.equals(day.closed()) && day.open() == null);
	}

	private static int minutes(String time) {
		LocalTime parsed = LocalTime.parse(time);
		return parsed.getHour() * 60 + parsed.getMinute();
	}

	/** 영업 구간과 그 안의 브레이크. 시작 포함, 끝 제외다. */
	private record Interval(int start, int end, List<Span> breaks) {
	}

	private record Span(int start, int end) {
	}

	private static PlaceCard withOpenStatus(PlaceCard card, OpenStatus status) {
		return new PlaceCard(card.place(), card.score(), card.labels(), card.caution(), status, card.reasons(),
				card.scoreItems());
	}

	private static PlaceDetailResponse withOpenStatus(PlaceDetailResponse detail, OpenStatus status) {
		return new PlaceDetailResponse(detail.place(), detail.address(), detail.tags(), detail.photos(), detail.phone(),
				detail.website(), status, detail.hours(), detail.closedDayNote(), detail.menus(), detail.facilities(),
				detail.subways(), detail.directions(), detail.parking(), detail.pet(), detail.noKidsZone(), detail.corkage(),
				detail.bookingUrl(), detail.seats(), detail.description(), detail.paymentMethods(), detail.broadcasts(),
				detail.extraLinks());
	}

	private static List<PlaceCard> page(List<PlaceCard> ranked, int offset) {
		if (offset >= ranked.size()) {
			return List.of();
		}
		return ranked.subList(offset, Math.min(offset + PAGE_SIZE, ranked.size()));
	}

	private static String nextCursor(List<PlaceCard> ranked, int offset) {
		// offset + PAGE_SIZE가 int 범위를 넘지 않도록 더하기 전에 마지막 페이지인지 판단한다.
		if (offset >= ranked.size() - PAGE_SIZE) {
			return null;
		}
		int next = offset + PAGE_SIZE;
		return Base64.getUrlEncoder().withoutPadding().encodeToString(
				Integer.toString(next).getBytes(StandardCharsets.UTF_8));
	}

	/** 커서는 십진수 오프셋 문자열을 패딩 없이 base64url로 인코딩한 값이다. */
	private static int decodeCursor(String cursor) {
		if (cursor.contains("=")) {
			throw new InvalidCursorException();
		}
		String offset;
		try {
			offset = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
		} catch (IllegalArgumentException e) {
			throw new InvalidCursorException();
		}
		if (!OFFSET_PATTERN.matcher(offset).matches()) {
			throw new InvalidCursorException();
		}
		try {
			return Integer.parseInt(offset);
		} catch (NumberFormatException e) {
			throw new InvalidCursorException();
		}
	}

	private static boolean isEmptyScenario() {
		if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
			return EMPTY_SCENARIO.equals(attributes.getRequest().getHeader(SCENARIO_HEADER));
		}
		return false;
	}

	private static PlaceSuggestResponse placeSuggestion(MockPlace place, String matchedMenu) {
		return new PlaceSuggestResponse(SuggestType.PLACE, place.card().place(), matchedMenu, null);
	}

	private static String firstMatchingMenu(MockPlace place, String needle) {
		return place.detail().menus().stream()
				.map(Menu::name)
				.filter(menuName -> lower(menuName).contains(needle))
				.findFirst()
				.orElse(null);
	}

	private static boolean matchesCategory(MockPlace place, String needle) {
		CategoryGroup category = place.card().place().categoryGroup();
		return CATEGORY_NAMES.get(category).contains(needle) || lower(category.name()).contains(needle);
	}

	private static String lower(String value) {
		return value.toLowerCase(Locale.ROOT);
	}

	private static List<MockPlace> load(JsonMapper jsonMapper) {
		try (InputStream in = new ClassPathResource("mock/places.json").getInputStream()) {
			return jsonMapper.readValue(in, MockPlaces.class).places();
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to load mock places", e);
		}
	}

	/** places.json의 루트(D-60). */
	private record MockPlaces(List<MockPlace> places) {
	}

	private record MockPlace(PlaceCard card, PlaceDetailResponse detail) {
	}

}
