package kr.co.fitdining.api.review.store;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 리뷰 한 건({@code reviews}, D-28). 장소와 작성자는 다른 모듈의 id 값으로만 든다.
 *
 * <p>삭제는 시각 컬럼({@code deleted_at})으로 둔다. 목록과 리뷰 수는 삭제한 리뷰를 뺀다. 공개 숨김과 분석 제외는
 * 운영 기능을 만들 때 같은 방식의 시각 컬럼으로 더한다(D-28, D-35).
 */
@Entity
@Table(name = "reviews")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Review {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long reviewId;

	@Column(nullable = false)
	private Long placeId;

	/** 작성자({@code auth_users.id}) */
	@Column(nullable = false)
	private String userId;

	@Column(nullable = false)
	private LocalDate visitDate;

	/** 본문. 없으면 null이다(D-6). */
	@Column(length = 500)
	private String description;

	@Column(nullable = false)
	private boolean revisitIntent;

	private Integer spentPerPerson;

	/** 작성 시각. 커서 비교가 어긋나지 않게 마이크로초로 자른 값이다. */
	@Column(nullable = false)
	private Instant createdAt;

	@Column(nullable = false)
	private Instant updatedAt;

	private Instant deletedAt;

	/**
	 * @param placeId 장소 id
	 * @param userId 작성자 id
	 * @param visitDate 방문일(KST)
	 * @param description 본문. 공백뿐이면 서비스가 null로 바꿔 넘긴다.
	 * @param createdAt 작성 시각. 마이크로초로 자른 값이다.
	 */
	public Review(long placeId, String userId, LocalDate visitDate, String description, Instant createdAt) {
		this.placeId = placeId;
		this.userId = userId;
		this.visitDate = visitDate;
		this.description = description;
		this.createdAt = createdAt;
		this.updatedAt = createdAt;
	}

}
