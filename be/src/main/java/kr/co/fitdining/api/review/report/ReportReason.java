package kr.co.fitdining.api.review.report;

/** 신고 사유(PRD FR-12, D-11). 설명은 {@link #OTHER}일 때만 받는다. */
public enum ReportReason {

	/** 광고·도배 */
	AD_SPAM,

	/** 욕설·혐오·음란물 */
	ABUSE,

	/** 장소와 무관한 내용 */
	UNRELATED,

	/** 기타 */
	OTHER

}
