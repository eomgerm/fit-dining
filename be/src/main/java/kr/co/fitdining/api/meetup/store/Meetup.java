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
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Objects;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.DecisionMethod;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.PollState;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 모임 한 건({@code meetups}, D-5). 모임장은 회원 id 값으로만 든다. 해석한 조건의 칸은 추천 연동 단계에서 매핑한다.
 */
@Entity
@Table(name = "meetups")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Meetup {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long meetupId;

	@Column(nullable = false, length = 22)
	private String code;

	/** 모임장({@code auth_users.id}) */
	@Column(nullable = false)
	private String hostUserId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private MeetupPhase phase;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private AreaKind areaKind;

	/** 역·동 이름. 지점이면 붙인 이름이고 없을 수 있다. */
	private String areaName;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private MeetupCategory category;

	private LocalDate meetDate;

	/** 모임 시각. 날짜가 있을 때만 있다. */
	private LocalTime meetTime;

	/** 인원. 정하지 않았으면 null이다. */
	private Integer headcount;

	/** 모임 설명. 앞뒤 공백을 지운 값이고, 없으면 null이다. */
	@Column(length = 100)
	private String description;

	/** 모임을 지울 시각(D-23) */
	@Column(nullable = false)
	private Instant expiresAt;

	/** 모임 정보를 마지막으로 바꾼 시각. 추천이 낡았는지 판단한다(D-9). */
	@Column(nullable = false)
	private Instant infoUpdatedAt;

	/** 투표 상태. 연 적이 없으면 null이고, 한 번 열면 비우지 않는다(D-5). */
	@Enumerated(EnumType.STRING)
	private PollState pollState;

	private Boolean pollAnonymous;

	/** 투표 후보. 모임장이 고른 순서다. */
	@JdbcTypeCode(SqlTypes.ARRAY)
	@Column(columnDefinition = "bigint[]")
	private Long[] pollPlaceIds;

	/** 동점으로 마감했을 때 고정한 표 수. 다시 열면 비운다(D-5). */
	private Integer pollTieVotes;

	private Long decidedPlaceId;

	@Enumerated(EnumType.STRING)
	private DecisionMethod decidedHow;

	private Instant decidedAt;

	public Meetup(String code, String hostUserId, AreaKind areaKind, String areaName, MeetupCategory category,
			LocalDate meetDate, LocalTime meetTime, Integer headcount, String description, Instant expiresAt,
			Instant now) {
		this.code = code;
		this.hostUserId = hostUserId;
		this.phase = MeetupPhase.WAITING;
		this.areaKind = areaKind;
		this.areaName = areaName;
		this.category = category;
		this.meetDate = meetDate;
		this.meetTime = meetTime;
		this.headcount = headcount;
		this.description = description;
		this.expiresAt = expiresAt;
		this.infoUpdatedAt = now;
	}

	public boolean hostedBy(String userId) {
		return hostUserId.equals(userId);
	}

	/** 대기·결과에서는 모든 항목을, 투표 중·정함에서는 날짜·시간만 고친다(AC-22, D-19). */
	public boolean infoEditable() {
		return phase == MeetupPhase.WAITING || phase == MeetupPhase.RESULT;
	}

	/** 모임 정보를 바꾼다. 하나라도 바뀌면 추천이 낡았다고 판단하도록 바꾼 시각을 남긴다(D-9). */
	public void edit(AreaKind areaKind, String areaName, MeetupCategory category, LocalDate meetDate,
			LocalTime meetTime, Integer headcount, String description, Instant expiresAt, Instant now) {
		boolean changed = areaKind != this.areaKind || !Objects.equals(areaName, this.areaName)
				|| category != this.category || !Objects.equals(meetDate, this.meetDate)
				|| !Objects.equals(meetTime, this.meetTime) || !Objects.equals(headcount, this.headcount)
				|| !Objects.equals(description, this.description);
		this.areaKind = areaKind;
		this.areaName = areaName;
		this.category = category;
		this.meetDate = meetDate;
		this.meetTime = meetTime;
		this.headcount = headcount;
		this.description = description;
		this.expiresAt = expiresAt;
		if (changed) {
			this.infoUpdatedAt = now;
		}
	}

	/** 추천은 대기나 결과 상태에서 투표를 연 적이 없을 때만 받는다(AC-15, D-19). */
	public boolean calculable() {
		return (phase == MeetupPhase.WAITING || phase == MeetupPhase.RESULT) && pollState == null;
	}

	/** 추천이 처음 성공하면 결과 상태로 간다(AC-16). */
	public void showResult() {
		if (phase == MeetupPhase.WAITING) {
			phase = MeetupPhase.RESULT;
		}
	}

	/** 투표를 연다(AC-36). 연 뒤에는 익명 여부와 후보를 바꾸지 않는다. */
	public void openPoll(List<Long> placeIds, boolean anonymous) {
		this.phase = MeetupPhase.VOTING;
		this.pollState = PollState.OPEN;
		this.pollAnonymous = anonymous;
		this.pollPlaceIds = placeIds.toArray(Long[]::new);
	}

	public List<Long> pollCandidates() {
		return pollPlaceIds == null ? List.of() : List.of(pollPlaceIds);
	}

	public boolean anonymousPoll() {
		return Boolean.TRUE.equals(pollAnonymous);
	}

	/** 동점으로 마감했는지. 마감할 때 고정한 값이라 뒤에 프로필을 지워도 바뀌지 않는다(AC-40). */
	public boolean tiedPoll() {
		return pollTieVotes != null;
	}

	/** 동점으로 닫힌 투표만 다시 연다(AC-40). */
	public boolean reopenable() {
		return phase == MeetupPhase.VOTING && pollState == PollState.CLOSED && tiedPoll();
	}

	/** 동점이라 마감하고 모임장의 선택을 기다린다(AC-40). */
	public void closeTied(int votes) {
		this.pollState = PollState.CLOSED;
		this.pollTieVotes = votes;
	}

	/** 투표 계속하기. 이미 받은 표는 그대로 둔다. */
	public void reopenPoll() {
		this.pollState = PollState.OPEN;
		this.pollTieVotes = null;
	}

	/** 정한다(AC-40, AC-41). 열린 투표가 있었으면 닫는다. */
	public void decide(long placeId, DecisionMethod method, Instant now) {
		if (pollState == PollState.OPEN) {
			pollState = PollState.CLOSED;
		}
		this.phase = MeetupPhase.DECIDED;
		this.decidedPlaceId = placeId;
		this.decidedHow = method;
		this.decidedAt = now;
	}

	/** 정하기 취소. 투표가 있었으면 닫힌 투표로, 없었으면 결과로 돌아간다(AC-41). */
	public void cancelDecision() {
		this.phase = pollState == null ? MeetupPhase.RESULT : MeetupPhase.VOTING;
		this.decidedPlaceId = null;
		this.decidedHow = null;
		this.decidedAt = null;
	}

}
