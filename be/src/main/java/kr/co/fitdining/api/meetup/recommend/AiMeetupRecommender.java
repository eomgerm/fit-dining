package kr.co.fitdining.api.meetup.recommend;

import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.engine.AiSearchClient.Reply;
import org.springframework.stereotype.Component;

/**
 * DB 모드의 추천기. AI 모임 계산 주소를 부른다(D-11, D-13). 계산 한 번에 AI를 세 번까지 부른다. 저장한 해석이 있으면
 * 계산만, 설명이 있는데 해석이 없으면 해석과 계산, AI가 저장한 해석을 읽지 못하면 계산, 해석, 계산이다(AC-46, AC-48).
 * 그 밖의 실패는 모두 계산 실패다(AC-56).
 */
@Component
@ConditionalOnCatalogMode
class AiMeetupRecommender implements MeetupRecommender {

	private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

	private final AiMeetupClient client;
	private final MeetupInterpretations interpretations;

	AiMeetupRecommender(AiMeetupClient client, MeetupInterpretations interpretations) {
		this.client = client;
		this.interpretations = interpretations;
	}

	@Override
	public MeetupRecommendation recommend(Input input) {
		MeetupInterpretation stored = input.interpretation();
		boolean fresh = false;
		if (input.description() != null && stored == null) {
			stored = interpretAndStore(input);
			fresh = true;
		}
		Reply<AiMeetupClient.Found> reply = client.search(body(input, stored));
		// 방금 해석한 조건을 읽지 못하면 다시 해석하지 않는다. 계산 한 번의 AI 호출을 세 번으로 묶는다.
		if (!fresh && stored != null && AiMeetupClient.conditionsInvalid(reply)) {
			interpretations.store(input.meetupId(), input.description(), null);
			reply = client.search(body(input, interpretAndStore(input)));
		}
		if (!reply.ok()) {
			throw new MeetupRecommenderUnavailableException();
		}
		return recommendation(reply.value());
	}

	private MeetupInterpretation interpretAndStore(Input input) {
		MeetupInterpretation interpretation = client.interpret(input.description())
				.orElseThrow(MeetupRecommenderUnavailableException::new);
		interpretations.store(input.meetupId(), input.description(), interpretation);
		return interpretation;
	}

	/**
	 * 계산 요청 본문(AC-46). 저장한 조건, 지역, 업종(상관없음이면 뺌), 날짜·시각, 참여자만 싣는다. 참여자는 프로필 번호와
	 * 회원 id, 보이는 질문의 답만 담고 이름은 담지 않는다. 먹고 싶은 메뉴는 적은 글 그대로다.
	 */
	static Map<String, Object> body(Input input, MeetupInterpretation interpretation) {
		Map<String, Object> body = new LinkedHashMap<>();
		if (interpretation != null) {
			body.put("conditions", interpretation.conditions());
		}
		body.put("area", area(input));
		if (input.category() != MeetupCategory.ANY) {
			body.put("category", input.category().name());
		}
		if (input.date() != null) {
			Map<String, Object> when = new LinkedHashMap<>();
			when.put("date", input.date().toString());
			if (input.time() != null) {
				when.put("time", input.time().format(HH_MM));
			}
			body.put("when", when);
		}
		body.put("members", input.members().stream().map(AiMeetupRecommender::member).toList());
		return body;
	}

	private static Map<String, Object> area(Input input) {
		Map<String, Object> area = new LinkedHashMap<>();
		if (input.areaKind() == AreaKind.POINT) {
			area.put("kind", "CIRCLE");
			area.put("lat", input.point().lat());
			area.put("lng", input.point().lng());
			area.put("radiusM", input.point().radiusM());
		} else {
			area.put("kind", input.areaKind().name());
			area.put("name", input.areaName());
		}
		return area;
	}

	private static Map<String, Object> member(Member member) {
		Map<String, Object> body = new LinkedHashMap<>();
		body.put("key", Long.toString(member.profileId()));
		if (member.userId() != null) {
			body.put("userId", member.userId());
		}
		Taste taste = member.taste();
		if (taste.mood() != null && taste.mood() != Mood.ANY) {
			body.put("mood", taste.mood().name());
		}
		putFoods(body, "likeFoods", taste.likeFoods());
		putFoods(body, "avoidFoods", taste.avoidFoods());
		if (taste.noSpicy() != null) {
			body.put("noSpicy", taste.noSpicy());
		}
		if (taste.priceCap() != null) {
			body.put("menuPriceCapWon", taste.priceCap());
		}
		if (taste.wantMenu() != null) {
			body.put("wantMenu", taste.wantMenu());
		}
		return body;
	}

	private static void putFoods(Map<String, Object> body, String name, List<FoodType> foods) {
		if (foods != null && !foods.isEmpty()) {
			body.put(name, foods.stream().map(FoodType::name).toList());
		}
	}

	private static MeetupRecommendation recommendation(AiMeetupClient.Found found) {
		List<MeetupRecommendation.Place> places = found.items().stream()
				.map(item -> new MeetupRecommendation.Place(item.placeId(), item.score(),
						Objects.requireNonNullElse(item.reasons(), List.of()), item.caution(),
						item.memberScores().stream()
								.map(score -> new MeetupRecommendation.MemberScore(
										AiMeetupClient.profileId(score.key()), score.score(),
										Boolean.TRUE.equals(score.unverified()), score.missedMenu()))
								.toList()))
				.toList();
		AiMeetupClient.EmptyReason empty = found.emptyReason();
		MeetupRecommendation.EmptyReason emptyReason = places.isEmpty() && empty != null
				? new MeetupRecommendation.EmptyReason(empty.cause(), empty.suggestion(),
						empty.memberKeys() == null ? null
								: empty.memberKeys().stream().map(AiMeetupClient::profileId).toList())
				: null;
		return new MeetupRecommendation(places, applied(found.applied()), emptyReason);
	}

	/** 모르는 분위기와 음식 종류는 뺀다. */
	private static MeetupRecommendation.Applied applied(AiMeetupClient.Applied applied) {
		if (applied == null) {
			return MeetupRecommendation.Applied.NONE;
		}
		Mood mood = known(Mood.class, applied.mood());
		List<String> menus = applied.wantMenus() == null || applied.wantMenus().isEmpty() ? null
				: List.copyOf(applied.wantMenus());
		return new MeetupRecommendation.Applied(mood == Mood.ANY ? null : mood, foods(applied.likeFoods()),
				foods(applied.avoidFoods()), applied.noSpicy(), applied.menuPriceCapWon(), menus);
	}

	private static List<FoodType> foods(List<String> names) {
		if (names == null) {
			return null;
		}
		List<FoodType> foods = names.stream().map(name -> known(FoodType.class, name)).filter(Objects::nonNull)
				.toList();
		return foods.isEmpty() ? null : foods;
	}

	private static <E extends Enum<E>> E known(Class<E> type, String name) {
		if (name == null) {
			return null;
		}
		try {
			return Enum.valueOf(type, name);
		} catch (IllegalArgumentException e) {
			return null;
		}
	}

}
