package kr.co.fitdining.api.review.store;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
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

	/** 리뷰와 같은 flush에 저장돼 등록이 실패하면 함께 남지 않는다(D-40). */
	@ElementCollection
	@CollectionTable(name = "review_reason_tags", joinColumns = @JoinColumn(name = "review_id"))
	@Column(name = "code")
	private Set<String> tagCodes = new LinkedHashSet<>();

	/**
	 * @param description 본문. 공백뿐이면 서비스가 null로 바꿔 넘긴다.
	 * @param createdAt 작성 시각. 마이크로초로 자른 값이다.
	 */
	public Review(long placeId, String userId, LocalDate visitDate, Collection<String> tagCodes,
			boolean revisitIntent, String description, Integer spentPerPerson, Instant createdAt) {
		this.placeId = placeId;
		this.userId = userId;
		this.visitDate = visitDate;
		this.tagCodes.addAll(tagCodes);
		this.revisitIntent = revisitIntent;
		this.description = description;
		this.spentPerPerson = spentPerPerson;
		this.createdAt = createdAt;
		this.updatedAt = createdAt;
	}

	/**
	 * 본문을 고친다. 작성자가 고칠 수 있는 것은 본문과 사진뿐이다(D-6). 작성 시각은 그대로라 목록 순서가 바뀌지 않는다.
	 * 같은 본문이면 아무것도 바꾸지 않아, 읽는 쪽이 {@code updated_at}을 변경으로 보지 않는다(D-34).
	 *
	 * @param description 본문. 공백뿐이면 서비스가 null로 바꿔 넘긴다.
	 */
	public void changeDescription(String description, Instant now) {
		if (Objects.equals(this.description, description)) {
			return;
		}
		this.description = description;
		this.updatedAt = now;
	}

	/** 목록과 리뷰 수에서 빼고, 같은 방문일로 다시 쓸 수 있게 한다(D-28). */
	public void delete(Instant now) {
		this.deletedAt = now;
		this.updatedAt = now;
	}

}
