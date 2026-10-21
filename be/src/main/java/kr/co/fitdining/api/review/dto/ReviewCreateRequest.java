package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.Size;

/**
 * 리뷰 등록 요청. Walking Skeleton은 본문 하나다(D-1).
 *
 * @param description 본문. 최대 500자이고 생략할 수 있다. 공백뿐이면 본문 없음으로 저장된다(D-6).
 */
public record ReviewCreateRequest(
		@Size(max = 500) String description
) {
}
