package kr.co.fitdining.api.place.dto;

import java.time.LocalDate;
import java.util.List;
import kr.co.fitdining.api.place.dto.PlaceCard.EvidenceSource;

/**
 * 상세 추천 이유. 요청의 {@code reasons}와 같은 순서다.
 *
 * @param reasons 이유마다 제목과 펼쳤을 때 보일 근거
 */
public record PlaceReasonsResponse(List<ReasonView> reasons) {

	/**
	 * 접었다 펴는 줄 1개. 펼친 곳에는 앱 리뷰가 있으면 앱 리뷰만, 없으면 페르소나 요약만 보인다. 둘 다 없으면 펼칠 수 없다.
	 *
	 * @param source 근거 출처
	 * @param label 근거 항목 문구(예: "조용해요")
	 * @param title 제목 한 문장. LLM이 쓰지 못하면 요청 항목의 {@code fallbackTitle}이다.
	 * @param reviews 이 특징을 좋았다고 고른 앱 리뷰. 최근 순으로 최대 2건이고, 없으면 빈 목록이다.
	 * @param personaSummary "~하는 손님" 한 줄. 앱 리뷰가 있거나, 그 특징과 관계있는 장소 페르소나가 없거나, 제목을 쓰지 못했으면
	 *     생략한다.
	 */
	public record ReasonView(
			EvidenceSource source,
			String label,
			String title,
			List<ReviewEvidence> reviews,
			String personaSummary
	) {
	}

	/**
	 * 근거가 된 앱 리뷰 1건. 리뷰 본문은 싣지 않는다(본문 구절 추출은 리뷰 본문 분석 작업 뒤에 붙인다).
	 *
	 * @param nickname 작성자 닉네임. 탈퇴한 회원이면 생략한다(리뷰 탭과 같다).
	 * @param visitedAt 방문일
	 * @param tag 이 특징을 좋았다고 고른 이유 태그 문구. 장소 업종의 문구다(예: "조용해서 좋았어요").
	 */
	public record ReviewEvidence(
			String nickname,
			LocalDate visitedAt,
			String tag
	) {
	}

}
