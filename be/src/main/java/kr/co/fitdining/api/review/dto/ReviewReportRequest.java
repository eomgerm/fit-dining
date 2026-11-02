package kr.co.fitdining.api.review.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import kr.co.fitdining.api.review.ReviewText;
import kr.co.fitdining.api.review.report.ReportReason;

/**
 * 리뷰 신고 요청(D-11).
 *
 * @param reason 신고 사유
 * @param detail 설명. "기타"일 때만 받고 생략할 수 있다. 공백뿐이면 설명 없음으로 저장된다.
 */
public record ReviewReportRequest(
		@NotNull ReportReason reason,
		@Size(max = ReviewReportRequest.DETAIL_MAX) String detail
) {
	public static final int DETAIL_MAX = 100;

	/** 이름이 getter 꼴이 아니어서 JSON 속성으로 읽히지 않는다. */
	public boolean detailAllowed() {
		return reason == ReportReason.OTHER || ReviewText.isBlank(detail);
	}
}
