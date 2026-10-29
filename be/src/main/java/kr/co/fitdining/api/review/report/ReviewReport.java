package kr.co.fitdining.api.review.report;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 리뷰 신고 한 건({@code review_reports}, D-11). 같은 사람은 같은 리뷰를 한 번만 신고한다. */
@Entity
@Table(name = "review_reports")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ReviewReport {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long reviewReportId;

	@Column(nullable = false)
	private Long reviewId;

	/** 신고자({@code auth_users.id}) */
	@Column(nullable = false)
	private String reporterId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private ReportReason reason;

	/** "기타"의 설명. 없으면 null이다. */
	@Column(length = 100)
	private String detail;

	@Column(nullable = false)
	private Instant createdAt;

	public ReviewReport(long reviewId, String reporterId, ReportReason reason, String detail, Instant createdAt) {
		this.reviewId = reviewId;
		this.reporterId = reporterId;
		this.reason = reason;
		this.detail = detail;
		this.createdAt = createdAt;
	}

}
