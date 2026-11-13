package kr.co.fitdining.api.meetup.store;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MeetupRepository extends JpaRepository<Meetup, Long> {

	Optional<Meetup> findByCode(String code);

	/** 모임의 모든 쓰기는 이 행을 잡고 상태를 확인한 뒤 고친다(D-4). */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Meetup> findLockedByCode(String code);

	/** 계산 작업이 결과를 저장할 때 잡는다. */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Meetup> findLockedByMeetupId(Long meetupId);

	/** 그 회원이 만든 모임과 회원 프로필로 참여한 모임. 최근에 만든 것이 앞이다(AC-75). */
	@Query("""
			select m from Meetup m
			where m.hostUserId = :userId
			   or m.meetupId in (select p.meetupId from MeetupProfile p where p.userId = :userId)
			order by m.meetupId desc""")
	List<Meetup> findMine(String userId, Pageable page);

	/** 그 회원이 만든 모임을 지운다. 프로필, 쿠키 세션, 계산은 DB가 따라 지운다(D-36). */
	@Modifying
	@Query("delete from Meetup m where m.hostUserId = :userId")
	int deleteHostedBy(String userId);

}
