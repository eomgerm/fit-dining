package kr.co.fitdining.api.meetup.store;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.List;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import kr.co.fitdining.api.meetup.recommend.MeetupRecommendation;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 추천 계산 한 번({@code meetup_calculations}, D-5, D-10). 상태는 조건을 건 수정 쿼리로만 바꿔, 늦게 끝난 계산이 실패로
 * 바뀐 행을 덮지 않게 한다. 남는 행은 마지막 성공 하나와 그 뒤의 실행 중이거나 실패한 하나까지다.
 */
@Entity
@Table(name = "meetup_calculations")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MeetupCalculation {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long calcId;

	@Column(nullable = false)
	private Long meetupId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private CalculationState state;

	@Column(nullable = false)
	private Instant startedAt;

	private Instant finishedAt;

	/** 계산에 넣은 프로필 수 */
	@Column(nullable = false)
	private Integer tasteCount;

	/** 계산에 넣은 프로필. 계산 뒤에 지운 프로필은 결과를 줄 때 뺀다. */
	@JdbcTypeCode(SqlTypes.ARRAY)
	@Column(nullable = false, columnDefinition = "bigint[]")
	private Long[] profileIds;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(columnDefinition = "jsonb")
	private List<MeetupRecommendation.Place> result;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(columnDefinition = "jsonb")
	private MeetupRecommendation.Applied applied;

	@JdbcTypeCode(SqlTypes.JSON)
	@Column(columnDefinition = "jsonb")
	private MeetupRecommendation.EmptyReason emptyReason;

	public MeetupCalculation(long meetupId, Instant startedAt, List<Long> profileIds) {
		this.meetupId = meetupId;
		this.state = CalculationState.RUNNING;
		this.startedAt = startedAt;
		this.tasteCount = profileIds.size();
		this.profileIds = profileIds.toArray(Long[]::new);
	}

	/** 성공으로 바꾼 행에만 부른다. */
	public void storeResult(MeetupRecommendation recommendation) {
		this.result = recommendation.places();
		this.applied = recommendation.applied();
		this.emptyReason = recommendation.emptyReason();
	}

	public List<Long> includedProfileIds() {
		return List.of(profileIds);
	}

}
