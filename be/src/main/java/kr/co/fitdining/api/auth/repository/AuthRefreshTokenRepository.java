package kr.co.fitdining.api.auth.repository;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthRefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Only the presented RT is explicitly locked; family revocation is a bounded-key update. */
public interface AuthRefreshTokenRepository extends JpaRepository<AuthRefreshToken, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from AuthRefreshToken t where t.jti = :jti")
    Optional<AuthRefreshToken> lockByJti(@Param("jti") String jti);

    /** Acquires the family lock before any revocation-path row locks. */
    @Query(value = "select 1 from pg_advisory_xact_lock(hashtext(:family))", nativeQuery = true)
    Integer lockFamily(@Param("family") String family);

    boolean existsByFamilyIdAndUserIdAndRevokedAtIsNull(String familyId, String userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AuthRefreshToken t set t.revokedAt = coalesce(t.revokedAt, :now), "
            + "t.revokeReason = coalesce(t.revokeReason, :reason) where t.familyId = :family and t.userId = :user")
    int revokeFamily(@Param("family") String family, @Param("user") String user,
            @Param("now") Instant now, @Param("reason") String reason);

    @Modifying(flushAutomatically = true)
    @Query("update AuthRefreshToken t set t.revokedAt = :now, t.revokeReason = 'WITHDRAWN' where t.userId = :user and t.revokedAt is null")
    int revokeUser(@Param("user") String user, @Param("now") Instant now);

    @Modifying
    @Query(value = "delete from auth_refresh_tokens where jti in (select jti from auth_refresh_tokens "
            + "where expires_at < :cutoff order by expires_at, jti limit :batch)", nativeQuery = true)
    int deleteExpiredBatch(@Param("cutoff") Instant cutoff, @Param("batch") int batch);
}
