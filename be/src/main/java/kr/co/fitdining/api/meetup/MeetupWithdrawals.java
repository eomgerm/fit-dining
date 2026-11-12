package kr.co.fitdining.api.meetup;

import kr.co.fitdining.api.meetup.store.MeetupProfileRepository;
import kr.co.fitdining.api.meetup.store.MeetupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 회원 탈퇴 때 모임 쪽 정리(AC-62, AC-63, D-36). 탈퇴 트랜잭션 안에서만 부른다. */
@Service
public class MeetupWithdrawals {

	private final MeetupRepository meetups;
	private final MeetupProfileRepository profiles;

	public MeetupWithdrawals(MeetupRepository meetups, MeetupProfileRepository profiles) {
		this.meetups = meetups;
		this.profiles = profiles;
	}

	/**
	 * 그 회원이 만든 모임을 모두 지우고, 다른 모임에 있는 그 회원의 프로필을 지운다. 계산에 들어간 프로필이 지워진
	 * 결과는 모임장의 프로필 지우기처럼 낡은 것으로 보인다.
	 */
	@Transactional(propagation = Propagation.MANDATORY)
	public void withdraw(String userId) {
		profiles.deleteOwnedBy(userId);
		meetups.deleteHostedBy(userId);
	}

}
