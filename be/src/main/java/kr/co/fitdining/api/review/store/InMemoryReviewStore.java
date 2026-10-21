package kr.co.fitdining.api.review.store;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.SortedMap;
import java.util.TreeMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * 메모리에만 저장하는 개발용 저장소(D-27). local과 dev에서만 {@code review.mock.enabled}로 켠다.
 * 재시작하면 {@code classpath:mock/reviews.json}의 시드만 남고, 인스턴스마다 데이터가 따로다.
 *
 * <p>전체 리뷰를 최신순 {@link TreeMap} 하나에 둔다. 페이지는 커서 다음부터 장소를 걸러 읽고, 상한을 넘으면
 * 맨 끝(가장 오래된 리뷰)을 버린다. 개발용이라 모든 메서드를 {@code synchronized}로 두는 것으로 충분하다.
 */
@Component
@ConditionalOnBooleanProperty("review.mock.enabled")
public class InMemoryReviewStore implements ReviewStore {

	/** 익명 등록이 반복돼도 메모리가 차지 않게 하는 전체 상한. 넘으면 가장 오래된 리뷰부터 버린다. */
	static final int CAPACITY = 5_000;

	private static final String SEED_PATH = "mock/reviews.json";

	private final TreeMap<ReviewCursor, StoredReview> reviews = new TreeMap<>(ReviewCursor.NEWEST_FIRST);
	private long nextId = 1;

	@Autowired
	public InMemoryReviewStore(JsonMapper jsonMapper) {
		this(loadSeed(jsonMapper));
	}

	/** 시드를 직접 넘긴다. 테스트에서 파일 없이 만들 때 쓴다. */
	public InMemoryReviewStore(List<NewReview> seed) {
		seed.forEach(this::save);
	}

	@Override
	public synchronized StoredReview save(NewReview newReview) {
		if (reviews.size() >= CAPACITY) {
			reviews.pollLastEntry();
		}
		StoredReview review = new StoredReview(nextId++, newReview.placeId(), newReview.description(),
				newReview.createdAt());
		reviews.put(ReviewCursor.of(review), review);
		return review;
	}

	@Override
	public synchronized List<StoredReview> findPage(long placeId, ReviewCursor after, int limit) {
		SortedMap<ReviewCursor, StoredReview> from = after == null ? reviews : reviews.tailMap(after, false);
		return from.values().stream()
				.filter(review -> review.placeId() == placeId)
				.limit(limit)
				.toList();
	}

	@Override
	public synchronized int count(long placeId) {
		return (int) reviews.values().stream()
				.filter(review -> review.placeId() == placeId)
				.count();
	}

	private static List<NewReview> loadSeed(JsonMapper jsonMapper) {
		try (InputStream in = new ClassPathResource(SEED_PATH).getInputStream()) {
			return jsonMapper.readValue(in, MockReviews.class).reviews().stream()
					.map(seed -> new NewReview(seed.placeId(), seed.description(),
							seed.createdAt().truncatedTo(ChronoUnit.MICROS)))
					.toList();
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to load mock reviews", e);
		}
	}

	/** reviews.json의 루트. id는 파일에 적지 않고 읽는 순서대로 1부터 매긴다. */
	private record MockReviews(List<SeedReview> reviews) {
	}

	private record SeedReview(Long placeId, String description, Instant createdAt) {
	}

}
