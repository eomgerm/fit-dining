package kr.co.fitdining.api.review.dto;

import java.time.OffsetDateTime;

/**
 * 목록의 리뷰 하나. 1차 후속에서 방문일, 닉네임, 태그, 사진 등이 더해지고 {@code createdAt}은 남는다(D-24).
 *
 * @param reviewId 리뷰 id
 * @param createdAt 작성 시각. Asia/Seoul 오프셋이다.
 * @param description 본문. 없으면 생략한다.
 */
public record ReviewItem(
		Long reviewId,
		OffsetDateTime createdAt,
		String description
) {
}
