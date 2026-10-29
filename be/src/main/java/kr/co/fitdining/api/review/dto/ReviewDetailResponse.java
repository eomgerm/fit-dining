package kr.co.fitdining.api.review.dto;

import java.util.List;

/**
 * 내 리뷰 하나. 수정 화면(6-07)이 고칠 수 있는 필드만 담는다(D-44, D-45).
 *
 * @param placeId 수정한 뒤 돌아갈 장소 상세와 다시 받을 목록의 장소
 * @param description 본문. 없으면 생략한다.
 * @param photos 사진. 화면 순서대로다.
 */
public record ReviewDetailResponse(
		Long reviewId,
		Long placeId,
		String description,
		List<PhotoView> photos,
		Limits limits
) {

	public record Limits(Integer descriptionMax, Integer photoMax) {
	}

}
