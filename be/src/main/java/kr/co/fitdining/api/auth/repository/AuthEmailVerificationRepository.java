package kr.co.fitdining.api.auth.repository;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthEmailVerification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 이메일별 발송 기록과 1회용 인증 토큰. 같은 이메일의 발송은 이메일 advisory lock으로 직렬화한다. */
public interface AuthEmailVerificationRepository extends JpaRepository<AuthEmailVerification, Long> {
    @Query(value = "select 1 from pg_advisory_xact_lock(hashtextextended(:key, 0))", nativeQuery = true)
    Integer lockEmail(@Param("key") String key);

    long countByEmailAndCreatedAtAfter(String email, Instant cutoff);

    /** 이메일의 가장 최근 발송 기록을 잠가 확인 시도 횟수 갱신을 직렬화한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<AuthEmailVerification> findTopByEmailOrderByCreatedAtDescIdDesc(String email);

    Optional<AuthEmailVerification> findByTokenHash(String tokenHash);

    /** 아직 확인하지 않은 이전 인증번호를 모두 만료시킨다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AuthEmailVerification v set v.expiresAt = :now "
            + "where v.email = :email and v.verifiedAt is null and v.expiresAt > :now")
    int expirePending(@Param("email") String email, @Param("now") Instant now);

    /** 동시 가입 요청 중 한 건만 토큰을 쓰도록 조건부로 사용 처리한다. @return 사용 처리한 행 수 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AuthEmailVerification v set v.consumedAt = :now where v.tokenHash = :tokenHash "
            + "and v.email = :email and v.consumedAt is null and v.tokenExpiresAt > :now")
    int consume(@Param("tokenHash") String tokenHash, @Param("email") String email, @Param("now") Instant now);

    @Modifying
    @Query(value = "delete from auth_email_verifications where id in (select id from auth_email_verifications "
            + "where created_at < :cutoff order by created_at, id limit :batch)", nativeQuery = true)
    int deleteExpiredBatch(@Param("cutoff") Instant cutoff, @Param("batch") int batch);
}
