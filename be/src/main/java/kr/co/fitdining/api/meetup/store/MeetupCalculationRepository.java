package kr.co.fitdining.api.meetup.store;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.meetup.domain.CalculationState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 계산 행. 상태를 바꾸는 쿼리는 모두 RUNNING인 행에만 걸려, 같은 행을 두 곳에서 바꿔도 먼저 바꾼 쪽만 남는다(D-10).
 */
public interface MeetupCalculationRepository extends JpaRepository<MeetupCalculation, Long> {

	/** @return 최근 계산부터 */
	List<MeetupCalculation> findByMeetupIdOrderByCalcIdDesc(Long meetupId);

	Optional<MeetupCalculation> findFirstByMeetupIdAndStateOrderByCalcIdDesc(Long meetupId, CalculationState state);

	boolean existsByMeetupIdAndState(Long meetupId, CalculationState state);

	/** 시작한 지 오래된 실행 중 계산을 실패로 바꾼다(AC-17). */
	@Modifying
	@Query("""
			update MeetupCalculation c
			set c.state = kr.co.fitdining.api.meetup.domain.CalculationState.FAILED, c.finishedAt = :now
			where c.meetupId = :meetupId and c.startedAt < :startedBefore
			and c.state = kr.co.fitdining.api.meetup.domain.CalculationState.RUNNING""")
	int failStale(@Param("meetupId") long meetupId, @Param("startedBefore") Instant startedBefore,
			@Param("now") Instant now);

	/** @return 바꾼 행 수. 이미 끝났거나 지워진 계산이면 0이다. */
	@Modifying
	@Query("""
			update MeetupCalculation c
			set c.state = kr.co.fitdining.api.meetup.domain.CalculationState.FAILED, c.finishedAt = :now
			where c.calcId = :calcId and c.state = kr.co.fitdining.api.meetup.domain.CalculationState.RUNNING""")
	int failIfRunning(@Param("calcId") long calcId, @Param("now") Instant now);

	/** @return 바꾼 행 수. 이미 실패로 바뀌었거나 지워진 계산이면 0이고, 그 결과는 버린다(AC-16). */
	@Modifying
	@Query("""
			update MeetupCalculation c
			set c.state = kr.co.fitdining.api.meetup.domain.CalculationState.SUCCEEDED, c.finishedAt = :now
			where c.calcId = :calcId and c.state = kr.co.fitdining.api.meetup.domain.CalculationState.RUNNING""")
	int succeedIfRunning(@Param("calcId") long calcId, @Param("now") Instant now);

	@Modifying
	@Query("""
			delete from MeetupCalculation c
			where c.meetupId = :meetupId and c.state = kr.co.fitdining.api.meetup.domain.CalculationState.FAILED""")
	int deleteFailed(@Param("meetupId") long meetupId);

	@Modifying
	@Query("delete from MeetupCalculation c where c.meetupId = :meetupId and c.calcId <> :keep")
	int deleteOthers(@Param("meetupId") long meetupId, @Param("keep") long keep);

}
