package kr.co.fitdining.api.auth.repository;

import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

/** User lookup uses the unique username index. */
@Transactional(readOnly = true)
public interface AuthUserRepository extends JpaRepository<AuthUser, String> {
    Optional<AuthUser> findByUsername(String username);
}
