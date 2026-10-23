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
    Optional<AuthUser> findByEmail(String email);
    @Query("select count(u) > 0 from AuthUser u where lower(u.nickname) = lower(:nickname)")
    boolean existsByNickname(@Param("nickname") String nickname);
}
