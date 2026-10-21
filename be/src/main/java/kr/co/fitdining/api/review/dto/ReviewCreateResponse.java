package kr.co.fitdining.api.review.dto;

/**
 * 리뷰 등록 응답.
 *
 * @param reviewId 등록된 리뷰 id
 */
public record ReviewCreateResponse(
		Long reviewId
) {
}
