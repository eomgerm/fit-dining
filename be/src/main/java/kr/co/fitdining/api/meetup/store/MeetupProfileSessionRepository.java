package kr.co.fitdining.api.meetup.store;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetupProfileSessionRepository extends JpaRepository<MeetupProfileSession, Long> {

	Optional<MeetupProfileSession> findByTokenHash(byte[] tokenHash);

}
