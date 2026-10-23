package kr.co.fitdining.api.auth.repository;

import java.time.Instant;
import kr.co.fitdining.api.auth.domain.AuthLoginAttempt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Address-scoped short transactions preserve the limit under concurrent login attempts. */
public interface AuthLoginAttemptRepository extends JpaRepository<AuthLoginAttempt, Long> {
    @Query(value = "select 1 from pg_advisory_xact_lock(hashtextextended(:address, 0))", nativeQuery = true)
    Integer lockAddress(@Param("address") String address);

    long countByAddressAndActionAndCreatedAtAfter(String address, String action, Instant cutoff);

    @Modifying
    @Query(value = "delete from auth_login_attempts where id in (select id from auth_login_attempts "
            + "where created_at < :cutoff order by created_at, id limit :batch)", nativeQuery = true)
    int deleteExpiredBatch(@Param("cutoff") Instant cutoff, @Param("batch") int batch);
}
