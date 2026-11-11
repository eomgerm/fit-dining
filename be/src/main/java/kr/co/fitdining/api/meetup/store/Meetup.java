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
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 모임 한 건({@code meetups}, D-5). 모임장은 회원 id 값으로만 든다. 투표, 정한 곳, 해석한 조건의 칸은 그 기능을
 * 만들 때 매핑한다.
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

}
