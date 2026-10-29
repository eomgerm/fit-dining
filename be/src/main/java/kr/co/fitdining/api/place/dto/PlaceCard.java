package kr.co.fitdining.api.place.dto;

import java.util.List;

/**
 * 검색 결과 카드. 상세 화면의 핏 점수, 추천 이유, 주의점도 이 카드의 값을 쓴다.
 *
 * @param place 장소 요약
 * @param score 핏 점수. 0~100 정수이고 화면에는 % 없이 그대로 보인다. AI 엔진이 붙기 전(DB 모드)에는 생략한다.
 * @param labels 카드에 보이는 장소 특징 2개. AI 엔진이 없으면 빈 목록이다.
 * @param caution 주의점. 없으면 생략한다.
 * @param openStatus 요청 시각 기준 영업 상태
 * @param reasons AI 추천 이유. AI 엔진이 없으면 빈 목록이다.
 * @param scoreItems 핏 점수를 이루는 항목. 상세 화면의 ⓘ 시트에 보인다. AI 엔진이 없으면 빈 목록이다.
 */
public record PlaceCard(
		PlaceSummary place,
		Integer score,
		List<String> labels,
		String caution,
		OpenStatus openStatus,
		List<Reason> reasons,
		List<ScoreItem> scoreItems
) {

	/**
	 * AI 추천 이유 1개.
	 *
	 * @param title 이유 제목
	 * @param tags 이 이유의 근거 칩
	 * @param quote 근거가 된 문장 인용. 없으면 생략한다.
	 * @param quoteSource 인용 출처(예: "앱 리뷰"). 없으면 생략한다.
	 */
	public record Reason(
			String title,
			List<ReasonTag> tags,
			String quote,
			String quoteSource
	) {
	}

	/**
	 * 추천 이유의 근거 칩. 화면에 "요청 · 조용해요"처럼 보인다.
	 *
	 * @param source 근거 출처
	 * @param label 칩 문구
	 */
	public record ReasonTag(
			EvidenceSource source,
			String label
	) {
	}

	/**
	 * 핏 점수를 이루는 항목 1개.
	 *
	 * @param source 근거 출처
	 * @param label 항목 이름
	 * @param matched 점수에 반영했는지 여부. false면 확인할 근거가 부족해 점수에 넣지 않은 항목이다.
	 * @param evidenceCount 근거가 된 앱 리뷰 수. 0 이상이다.
	 */
	public record ScoreItem(
			EvidenceSource source,
			String label,
			Boolean matched,
			Integer evidenceCount
	) {
	}

	/** 근거 출처 */
	public enum EvidenceSource {
		/** 이번 검색 요청에서 나온 조건. 화면: "요청 ·" */
		REQUEST,
		/** 사용자 취향에서 나온 조건. 화면: "내 취향 ·" */
		PREFERENCE
	}

}
