package kr.co.fitdining.api.review.tag;

/**
 * 업종에 노출되는 리뷰 이유 태그.
 *
 * @param code 태그 코드
 * @param featureCode 장소에서 실제로 그랬던 쪽의 특징 코드(AI 코드표)
 * @param sentiment 좋았어요·아쉬웠어요
 * @param label 업종 문구가 있으면 그 문구, 없으면 기본 문구
 * @param displayGroup 화면 묶음
 */
public record ReasonTag(
		String code,
		String featureCode,
		Sentiment sentiment,
		String label,
		String displayGroup
) {

	public enum Sentiment {
		GOOD,
		BAD
	}

}
