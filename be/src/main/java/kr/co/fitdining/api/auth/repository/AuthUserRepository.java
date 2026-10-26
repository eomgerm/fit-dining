package kr.co.fitdining.api.auth.repository;

import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

/** User lookup uses the unique email index. */
@Transactional(readOnly = true)
public interface AuthUserRepository extends JpaRepository<AuthUser, String> {
    @Query("select u from AuthUser u where u.email = :email and u.deletedAt is null")
    Optional<AuthUser> findByEmail(@Param("email") String email);
    boolean existsByIdAndDeletedAtIsNull(String id);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from AuthUser u where u.id = :id")
    Optional<AuthUser> lockById(@Param("id") String id);
    @Query("select count(u) > 0 from AuthUser u where lower(u.nickname) = lower(:nickname) and u.deletedAt is null")
    boolean existsByNickname(@Param("nickname") String nickname);
}
