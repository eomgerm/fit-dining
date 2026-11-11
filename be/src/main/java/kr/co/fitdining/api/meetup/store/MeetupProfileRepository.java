package kr.co.fitdining.api.meetup.store;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetupProfileRepository extends JpaRepository<MeetupProfile, Long> {

	/** 들어온 순서(번호 순)의 프로필 목록 */
	List<MeetupProfile> findByMeetupIdOrderByProfileId(Long meetupId);

	Optional<MeetupProfile> findByProfileIdAndMeetupId(Long profileId, Long meetupId);

}
