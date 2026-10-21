package kr.co.fitdining.api.review;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.exception.ReviewUnavailableException;
import kr.co.fitdining.api.review.store.NewReview;
import kr.co.fitdining.api.review.store.ReviewCursor;
import kr.co.fitdining.api.review.store.ReviewStore;
import kr.co.fitdining.api.review.store.StoredReview;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

/**
 * 본문 정규화, 작성 시각, 커서 페이지 계산을 맡는다. 저장소 유무(503)만 판단하고 장소 존재는 확인하지
 * 않는다(D-21). 1차 후속에서 사용자, 장소 확인, 방문일 정책, 중복 금지가 여기에 더해진다.
 */
@Service
public class ReviewService {

	static final int PAGE_SIZE = 20;

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	/** 저장소 구현은 스위치로 등록되므로 선택적으로 받는다(없으면 503). 검색 {@code PlaceService}와 같은 방식이다. */
	private final ObjectProvider<ReviewStore> storeProvider;
	private final Clock clock;

	public ReviewService(ObjectProvider<ReviewStore> storeProvider, Optional<Clock> clock) {
		this.storeProvider = storeProvider;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	public ReviewCreateResponse create(long placeId, ReviewCreateRequest request) {
		// PostgreSQL은 마이크로초까지만 저장하므로 1차 후속에 커서 비교가 어긋나지 않게 지금부터 자른다(D-27).
		Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
		StoredReview saved = store().save(new NewReview(placeId, normalize(request.description()), now));
		return new ReviewCreateResponse(saved.reviewId());
	}

	public ReviewListResponse list(long placeId, String cursor) {
		ReviewCursor after = cursor == null || cursor.isEmpty() ? null : ReviewCursor.decode(cursor);
		ReviewStore store = store();
		// 한 건을 더 읽어 다음 페이지가 있는지 판단한다.
		List<StoredReview> rows = store.findPage(placeId, after, PAGE_SIZE + 1);
		boolean hasNext = rows.size() > PAGE_SIZE;
		List<StoredReview> page = hasNext ? rows.subList(0, PAGE_SIZE) : rows;
		String nextCursor = hasNext ? ReviewCursor.of(page.getLast()).encode() : null;
		return new ReviewListResponse(store.count(placeId), page.stream().map(ReviewService::toItem).toList(),
				nextCursor);
	}

	/** 공백뿐인 본문은 본문 없음(null)이다(D-6). 길이 검증은 원문 기준이라 그 밖에는 그대로 둔다. */
	static String normalize(String description) {
		return description == null || description.isBlank() ? null : description;
	}

	private static ReviewItem toItem(StoredReview review) {
		return new ReviewItem(review.reviewId(), review.createdAt().atZone(SEOUL).toOffsetDateTime(),
				review.description());
	}

	private ReviewStore store() {
		ReviewStore store = storeProvider.getIfAvailable();
		if (store == null) {
			throw new ReviewUnavailableException();
		}
		return store;
	}

}
