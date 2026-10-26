package kr.co.fitdining.api.review.dto;

import java.util.List;

/**
 * 장소의 리뷰 목록 응답.
 *
 * @param totalCount 장소의 리뷰 수(삭제 제외). 첫 페이지에만 있고 다음 페이지에서는 생략한다.
 * @param items 이번 페이지의 리뷰. 최신순이고 한 번에 최대 20개다(D-24).
 * @param nextCursor 다음 페이지를 요청할 때 보낼 값. 다음 페이지가 있을 때만 있다.
 */
public record ReviewListResponse(
		Integer totalCount,
		List<ReviewItem> items,
		String nextCursor
) {
}
