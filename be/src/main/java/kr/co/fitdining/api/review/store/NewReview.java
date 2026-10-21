package kr.co.fitdining.api.review.store;

import java.time.Instant;

/**
 * 저장할 새 리뷰. 서비스가 본문을 정규화하고 작성 시각을 정한 뒤 넘긴다.
 *
 * @param placeId 장소 id
 * @param description 본문. 공백뿐인 본문은 서비스가 null로 바꾼 뒤 넘긴다(D-6).
 * @param createdAt 작성 시각. 마이크로초로 자른 값이다(D-27).
 */
public record NewReview(
		long placeId,
		String description,
		Instant createdAt
) {
}
