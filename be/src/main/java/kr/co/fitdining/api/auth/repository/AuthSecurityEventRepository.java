package kr.co.fitdining.api.auth.repository;

import java.time.Instant;
import kr.co.fitdining.api.auth.domain.AuthSecurityEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Events have no FK to refresh tokens so evidence survives token cleanup. */
public interface AuthSecurityEventRepository extends JpaRepository<AuthSecurityEvent, Long> {
    long countByFamilyId(String familyId);

    @Modifying
    @Query(value = "delete from auth_security_events where id in (select id from auth_security_events "
            + "where created_at < :cutoff order by created_at, id limit :batch)", nativeQuery = true)
    int deleteExpiredBatch(@Param("cutoff") Instant cutoff, @Param("batch") int batch);
}
