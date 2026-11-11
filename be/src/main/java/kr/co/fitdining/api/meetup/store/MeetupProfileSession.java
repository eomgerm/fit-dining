package kr.co.fitdining.api.meetup.store;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 모임 쿠키 하나({@code meetup_profile_sessions}, D-7). 쿠키 값은 저장하지 않고 SHA-256 해시만 둔다. 프로필이 지워지면
 * 따라 지워진다.
 */
@Entity
@Table(name = "meetup_profile_sessions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MeetupProfileSession {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long sessionId;

	@Column(nullable = false)
	private Long profileId;

	@Column(nullable = false)
	private byte[] tokenHash;

	public MeetupProfileSession(Long profileId, byte[] tokenHash) {
		this.profileId = profileId;
		this.tokenHash = tokenHash;
	}

}
