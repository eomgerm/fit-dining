package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 리뷰 수정 요청(D-6, D-44). 고칠 수 있는 것은 본문과 사진뿐이라 다른 필드(방문일, 태그, 1인당 금액 등)는 받지 않는다.
 * 사진(S15P31A302-54)이 더해지면 둘 중 하나만 있어도 되고 없는 필드는 그대로 둔다.
 *
 * @param description 본문. 빈 문자열이나 공백이면 본문 없음으로 저장된다.
 */
public record ReviewUpdateRequest(
		@NotNull @Size(max = ReviewCreateRequest.DESCRIPTION_MAX) String description
) {
}
