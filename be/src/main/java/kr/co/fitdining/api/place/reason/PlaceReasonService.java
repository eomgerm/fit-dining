package kr.co.fitdining.api.place.reason;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.PlaceCard.Reason;
import kr.co.fitdining.api.place.dto.PlaceReasonsRequest;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse.ReasonView;
import kr.co.fitdining.api.place.dto.PlaceReasonsResponse.ReviewEvidence;
import kr.co.fitdining.api.place.reason.ReasonEvidenceRepository.Persona;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 상세 추천 이유. 이유마다 근거(앱 리뷰, 장소 페르소나)를 모으고 AI 제목 API로 제목을 받는다. 만든 응답은 캐시에 둬서
 * 같은 검색의 같은 장소를 다시 열면 같은 제목이 보이고 LLM을 다시 부르지 않는다(ai/docs/comparison/spec.md 4.5).
 *
 * <p>캐시 열쇠는 장소 id, 요청 문장, 고른 이유다. BE는 검색 id를 확인할 수 없어 열쇠에 넣지 않고, 요청 내용 전체를 열쇠로 써서
 * 다른 요청의 응답이 섞이지 않게 한다. AI가 실패한 응답은 캐시에 넣지 않는다.
 */
@Service
public class PlaceReasonService {

	static final int REVIEW_COUNT = 2;
	static final Duration CACHE_TTL = Duration.ofHours(6);
	static final long CACHE_SIZE = 10_000;

	private final PlaceService places;
	private final ReasonEvidenceRepository evidence;
	private final AiReasonClient ai;
	private final Cache<Key, PlaceReasonsResponse> cache;

	@Autowired
	PlaceReasonService(PlaceService places, ReasonEvidenceRepository evidence, AiReasonClient ai) {
		this(places, evidence, ai, Caffeine.newBuilder().expireAfterWrite(CACHE_TTL).maximumSize(CACHE_SIZE).build());
	}

	PlaceReasonService(PlaceService places, ReasonEvidenceRepository evidence, AiReasonClient ai,
			Cache<Key, PlaceReasonsResponse> cache) {
		this.places = places;
		this.evidence = evidence;
		this.ai = ai;
		this.cache = cache;
	}

	/**
	 * 상세 추천 이유를 만든다.
	 *
	 * @param placeId 장소 id
	 * @param request 그 검색의 요청 문장과 카드의 {@code reasons}
	 * @return 요청 {@code reasons}와 같은 순서의 이유
	 * @throws kr.co.fitdining.api.place.exception.PlaceNotFoundException 장소가 없을 때
	 */
	public PlaceReasonsResponse reasons(long placeId, PlaceReasonsRequest request) {
		Key key = new Key(placeId, request.request(), List.copyOf(request.reasons()));
		PlaceReasonsResponse cached = cache.getIfPresent(key);
		if (cached != null) {
			return cached;
		}
		String category = places.getPlace(placeId).place().categoryGroup().name();
		List<Found> found = request.reasons().stream().map(reason -> find(placeId, category, reason)).toList();
		Optional<AiReasonClient.Response> titles = ai.titles(new AiReasonClient.Request(request.request(), category,
				found.stream().map(Found::item).toList()));
		List<ReasonView> views = new ArrayList<>();
		for (int i = 0; i < found.size(); i++) {
			int index = i;
			views.add(view(found.get(i), titles.map(t -> t.titles().get(index)).orElse(null)));
		}
		PlaceReasonsResponse response = new PlaceReasonsResponse(List.copyOf(views));
		if (titles.isPresent() && !titles.get().llmFailed()) {
			cache.put(key, response);
		}
		return response;
	}

	/** 장소 정보로 판정한 이유(시설, 음식 종류)는 근거를 찾지 않는다. */
	private Found find(long placeId, String category, Reason reason) {
		boolean reviews = Boolean.TRUE.equals(reason.fromReviews());
		Optional<Persona> persona = reviews ? evidence.persona(placeId, reason.code()) : Optional.empty();
		List<ReviewEvidence> rows = reviews
				? evidence.reviews(placeId, reason.code(), category, REVIEW_COUNT).stream()
						.map(r -> new ReviewEvidence(r.nickname(), r.visitedAt(), r.tag())).toList()
				: List.of();
		AiReasonClient.Item item = new AiReasonClient.Item(reason.source().name(), reason.code(), reason.value(),
				reviews, persona.map(p -> new AiReasonClient.Persona(p.name(), p.description(), p.reason()))
						.orElse(null),
				List.of());
		return new Found(reason, persona, rows, item);
	}

	/**
	 * 앱 리뷰가 있으면 앱 리뷰만, 없으면 페르소나 요약만 싣는다. 페르소나 요약은 AI가 그 특징과 관계있다고 판단해 준 것만
	 * 싣는다. 가장 가까운 페르소나도 다른 특징 이야기인 경우가 많아서다. AI가 실패하면 대체 제목을 쓰고 요약은 싣지 않는다.
	 */
	private static ReasonView view(Found found, AiReasonClient.Title title) {
		Reason reason = found.reason();
		String summary = found.reviews().isEmpty() && title != null ? title.personaSummary() : null;
		return new ReasonView(reason.source(), reason.label(),
				title != null ? title.title() : reason.fallbackTitle(), found.reviews(), summary);
	}

	/**
	 * 캐시 열쇠. 요청 내용 전체라 같은 열쇠면 같은 입력이다.
	 *
	 * @param placeId 장소 id
	 * @param request 요청 문장. 없으면 null이다.
	 * @param reasons 고른 이유
	 */
	record Key(long placeId, String request, List<Reason> reasons) {
	}

	private record Found(Reason reason, Optional<Persona> persona, List<ReviewEvidence> reviews,
			AiReasonClient.Item item) {
	}

}
