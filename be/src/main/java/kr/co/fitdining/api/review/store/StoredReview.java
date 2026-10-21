package kr.co.fitdining.api.review.store;

import java.time.Instant;

/**
 * 저장소가 돌려주는 리뷰. 저장소 구현(메모리, 1차 후속의 DB)에 관계없이 같은 모양이다.
 *
 * @param reviewId 리뷰 id. 저장소가 차례로 매긴다.
 * @param placeId 장소 id
 * @param description 본문. 없으면 null이다.
 * @param createdAt 작성 시각. 마이크로초까지만 있다(D-27).
 */
public record StoredReview(
		long reviewId,
		long placeId,
		String description,
		Instant createdAt
) {
}
