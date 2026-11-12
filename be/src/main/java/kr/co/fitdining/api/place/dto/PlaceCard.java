package kr.co.fitdining.api.place.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 검색 결과 카드. 상세 화면의 핏 점수와 추천 이유 항목도 이 카드의 값을 쓴다.
 *
 * @param place 장소 요약
 * @param score 핏 점수. 0~100 정수이고 화면에는 % 없이 그대로 보인다. AI 결과가 없으면(대체 결과) 생략한다.
 * @param labels 카드에 보이는 장소 특징 2개. AI 결과가 없으면 빈 목록이다.
 * @param caution 주의점. 없으면 생략한다.
 * @param openStatus 요청 시각 기준 영업 상태
 * @param reasons 상세 추천 이유로 고른 항목. 요청 최대 2개, 그다음 취향 최대 2개다. 제목은 상세를 열 때
 *     상세 추천 이유 API가 쓴다. AI 결과가 없으면 빈 목록이다.
 * @param scoreItems 핏 점수를 이루는 항목. 상세 화면의 ⓘ 시트에 보인다. AI 결과가 없으면 빈 목록이다.
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
	 * 상세 추천 이유로 고른 항목 1개. FE는 상세 추천 이유 API에 이 값을 그대로 보낸다. 검증 제약은 그 요청에만
	 * 걸린다(AI 응답은 검증하지 않고 넘긴다).
	 *
	 * @param source 근거 출처
	 * @param code 조건 코드(예: {@code QUIET}). 근거(리뷰 이유 태그, 장소 페르소나)를 찾는 열쇠다.
	 * @param label 근거 항목 문구(예: "조용해요"). 상세 줄 머리글에 보인다.
	 * @param value 항목 점수(0~1)
	 * @param fromReviews 리뷰로 판정했는지. false면 장소 정보(시설, 음식 종류)로 판정해 근거를 모으지 않는다.
	 * @param fallbackTitle LLM 없이 쓰는 제목. 제목을 쓰지 못하면 이 문구를 보인다.
	 */
	public record Reason(
			@NotNull EvidenceSource source,
			@NotBlank @Size(max = 40) @Pattern(regexp = "[A-Z_]+") String code,
			@NotBlank @Size(max = 40) String label,
			@NotNull @DecimalMin("0") @DecimalMax("1") Double value,
			@NotNull Boolean fromReviews,
			@NotBlank @Size(max = 80) String fallbackTitle
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
