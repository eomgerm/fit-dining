package kr.co.fitdining.api.meetup.store;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetupRepository extends JpaRepository<Meetup, Long> {

	Optional<Meetup> findByCode(String code);

}
