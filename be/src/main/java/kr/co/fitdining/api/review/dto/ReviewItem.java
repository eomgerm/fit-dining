package kr.co.fitdining.api.review.dto;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 목록의 리뷰 하나(D-24, D-42). 사진과 숨김 표시는 각 기능에서 더한다.
 *
 * @param reviewId 리뷰 id
 * @param createdAt 작성 시각. Asia/Seoul 오프셋이다. 화면은 방문일을 보이지만 직전 FE를 위해 남긴다.
 * @param visitedAt 방문일(KST)
 * @param nickname 작성자의 지금 닉네임. 탈퇴한 회원이면 생략한다(D-38).
 * @param revisitIntent 재방문 의사
 * @param tags 이유 태그. 좋았어요가 먼저다.
 * @param description 본문. 없으면 생략한다.
 * @param mine 조회한 사용자의 리뷰인지. 로그인 없이 조회하면 false다.
 */
public record ReviewItem(
		Long reviewId,
		OffsetDateTime createdAt,
		LocalDate visitedAt,
		String nickname,
		Boolean revisitIntent,
		List<TagView> tags,
		String description,
		Boolean mine
) {
}
