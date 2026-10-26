package kr.co.fitdining.api.user;

import java.time.Clock;
import kr.co.fitdining.api.auth.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.transaction.annotation.Transactional;

/** Serializes withdrawal with login and refresh through the account row lock. */
@Service @ConditionalOnWebApplication @RequiredArgsConstructor
public class UserService {
    private final AuthUserRepository users;
    private final UserPreferencesRepository preferences;
    private final AuthRefreshTokenRepository tokens;
    private final Clock clock;
    @Transactional
    public void withdraw(String userId) {
        users.lockById(userId).ifPresent(user -> {
            if (user.getDeletedAt() != null) return;
            var now = clock.instant();
            user.withdraw(now);
            preferences.deleteById(userId);
            tokens.revokeUser(userId, now);
        });
    }
}
