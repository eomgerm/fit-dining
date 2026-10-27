package kr.co.fitdining.api.auth.repository;

import kr.co.fitdining.api.auth.domain.AuthSocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;

/** Provider identity lookup. */
public interface AuthSocialAccountRepository extends JpaRepository<AuthSocialAccount, AuthSocialAccount.Key> {
    /** Deletes provider links in the withdrawal transaction. */
    void deleteByUserId(String userId);
}
