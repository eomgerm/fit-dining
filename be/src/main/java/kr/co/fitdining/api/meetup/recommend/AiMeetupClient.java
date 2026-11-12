package kr.co.fitdining.api.meetup.recommend;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.MeetupInterpretation;
import kr.co.fitdining.api.place.catalog.ConditionalOnCatalogMode;
import kr.co.fitdining.api.place.engine.AiSearchClient;
import kr.co.fitdining.api.place.engine.AiSearchClient.Reply;
import org.springframework.stereotype.Component;

/**
 * AI의 모임 전용 주소 두 개를 부른다(ai/docs/comparison/api.md 7장). 일반 검색과 같은 시간 예산, 동시 호출 상한,
 * circuit breaker를 함께 쓴다(D-13, AC-46). 요청에는 프로필 번호만 싣고 이름을 싣지 않으며, 본문은 로그에 남기지 않는다
 * (AC-72).
 */
@Component
@ConditionalOnCatalogMode
class AiMeetupClient implements MeetupInterpreter {

	static final String INTERPRET_PATH = "/v1/meetup/interpret";
	static final String SEARCH_PATH = "/v1/meetup/search";
	/** 저장한 해석을 AI가 읽지 못할 때의 ProblemDetail {@code code}(AC-48) */
	static final String CONDITIONS_INVALID = "CONDITIONS_INVALID";

	private final AiSearchClient ai;

	AiMeetupClient(AiSearchClient ai) {
		this.ai = ai;
	}

	@Override
	public Optional<MeetupInterpretation> interpret(String description) {
		Reply<Interpreted> reply = ai.post("meetup interpret", INTERPRET_PATH, Map.of("text", description),
				Interpreted.class, AiMeetupClient::readable);
		return Optional.ofNullable(reply.value()).map(interpreted -> new MeetupInterpretation(
				interpreted.conditions(), new MeetupInterpretation.Summary(interpreted.summary().mentionsFood())));
	}

	/**
	 * @param body 모임 계산 요청 본문
	 * @return 결과. 읽을 수 있는 200이면 값이 있다.
	 */
	Reply<Found> search(Map<String, Object> body) {
		return ai.post("meetup search", SEARCH_PATH, body, Found.class, AiMeetupClient::readable);
	}

	static boolean conditionsInvalid(Reply<?> reply) {
		return reply.status() == 400 && CONDITIONS_INVALID.equals(reply.code());
	}

	private static boolean readable(Interpreted interpreted) {
		return interpreted.conditions() != null && interpreted.summary() != null
				&& interpreted.summary().mentionsFood() != null;
	}

	/** 장소, 프로필 번호, 이유의 근거, 목록 원소가 null이 아니고 프로필 번호가 숫자다. */
	private static boolean readable(Found found) {
		return found.items() != null && noNulls(found.items())
				&& found.items().stream().allMatch(item -> item.placeId() != null && noNulls(item.reasons())
						&& (item.reasons() == null || item.reasons().stream().allMatch(r -> noNulls(r.tags())))
						&& item.memberScores() != null && noNulls(item.memberScores())
						&& item.memberScores().stream().allMatch(score -> profileId(score.key()) != null))
				&& (found.emptyReason() == null || found.emptyReason().memberKeys() == null
						|| found.emptyReason().memberKeys().stream().allMatch(key -> profileId(key) != null));
	}

	static Long profileId(String key) {
		if (key == null || !key.matches("\\d{1,18}")) {
			return null;
		}
		return Long.parseLong(key);
	}

	private static boolean noNulls(List<?> list) {
		return list == null || list.stream().noneMatch(Objects::isNull);
	}

	/** 해석 주소 응답 중 BE가 읽는 속성 */
	record Interpreted(Map<String, Object> conditions, Summary summary) {

		record Summary(Boolean mentionsFood) {
		}
	}

	/**
	 * 계산 주소 응답 중 BE가 읽는 속성. 그 밖의 속성(라벨, {@code fallbacks})은 무시한다.
	 *
	 * @param applied 적용한 합친 취향. 빠지면 null이다.
	 * @param items 장소. AI가 정한 순서다.
	 * @param emptyReason 후보가 없을 때의 원인
	 */
	record Found(Applied applied, List<Item> items, EmptyReason emptyReason) {
	}

	record Applied(String mood, List<String> likeFoods, List<String> avoidFoods, Boolean noSpicy,
			Integer menuPriceCapWon, List<String> wantMenus) {
	}

	record Item(Long placeId, Integer score, List<MeetupRecommendation.Reason> reasons, String caution,
			List<MemberScore> memberScores) {
	}

	record MemberScore(String key, Integer score, Boolean unverified, String missedMenu) {
	}

	record EmptyReason(String cause, String suggestion, List<String> memberKeys) {
	}

}
