package kr.co.fitdining.api.review.dto;

/**
 * 내 리뷰 하나. 수정 화면(6-07)이 고칠 수 있는 필드만 담는다(D-44). 사진은 S15P31A302-54에서 더한다.
 *
 * @param placeId 수정한 뒤 돌아갈 장소 상세와 다시 받을 목록의 장소
 * @param description 본문. 없으면 생략한다.
 */
public record ReviewDetailResponse(
		Long reviewId,
		Long placeId,
		String description,
		Limits limits
) {

	public record Limits(Integer descriptionMax, Integer photoMax) {
	}

}
