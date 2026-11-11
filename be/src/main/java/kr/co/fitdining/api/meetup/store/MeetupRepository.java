package kr.co.fitdining.api.meetup.store;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface MeetupRepository extends JpaRepository<Meetup, Long> {

	Optional<Meetup> findByCode(String code);

	/** 모임의 모든 쓰기는 이 행을 잡고 상태를 확인한 뒤 고친다(D-4). */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Meetup> findLockedByCode(String code);

	/** 계산 작업이 결과를 저장할 때 잡는다. */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Meetup> findLockedByMeetupId(Long meetupId);

}
