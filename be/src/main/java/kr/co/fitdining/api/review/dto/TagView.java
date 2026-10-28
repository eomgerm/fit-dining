package kr.co.fitdining.api.review.dto;

import kr.co.fitdining.api.review.tag.ReasonTag;

/**
 * 목록 항목의 이유 태그.
 *
 * @param code 태그 코드
 * @param label 장소 업종의 문구. 업종 문구가 없으면 기본 문구다.
 * @param sentiment 좋았어요·아쉬웠어요
 */
public record TagView(
		String code,
		String label,
		ReasonTag.Sentiment sentiment
) {
}
