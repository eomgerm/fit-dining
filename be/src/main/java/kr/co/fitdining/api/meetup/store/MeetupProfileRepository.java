package kr.co.fitdining.api.meetup.store;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MeetupProfileRepository extends JpaRepository<MeetupProfile, Long> {

	/** 들어온 순서(번호 순)의 프로필 목록 */
	List<MeetupProfile> findByMeetupIdOrderByProfileId(Long meetupId);

	Optional<MeetupProfile> findByProfileIdAndMeetupId(Long profileId, Long meetupId);

	/** 모임마다 프로필 수. 행은 {모임 id, 수}다. */
	@Query("select p.meetupId, count(p) from MeetupProfile p where p.meetupId in :meetupIds group by p.meetupId")
	List<Object[]> countByMeetupIds(Collection<Long> meetupIds);

	/** 그 회원의 프로필을 모두 지운다. 취향과 표는 프로필 행에 있고 쿠키 세션은 DB가 따라 지운다(D-36). */
	@Modifying
	@Query("delete from MeetupProfile p where p.userId = :userId")
	int deleteOwnedBy(String userId);

}
