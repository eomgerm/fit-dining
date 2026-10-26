package kr.co.fitdining.api.user;

import java.time.Clock;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.auth.repository.AuthRefreshTokenRepository;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
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
    @Transactional(readOnly = true)
    public UserPreferences preferences(String userId, Identity identity) {
        requireOwner(userId, identity);
        if (!users.existsByIdAndDeletedAtIsNull(userId))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다.");
        return preferences.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다."));
    }
    private void requireOwner(String userId, Identity identity) {
        if (!userId.equals(identity.userId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "접근 권한이 없습니다.");
    }
    @Transactional
    public void withdraw(String userId, Identity identity) {
        requireOwner(userId, identity);
        users.lockById(userId).ifPresent(user -> {
            if (user.getDeletedAt() != null) return;
            var now = clock.instant();
            user.withdraw(now);
            preferences.deleteById(userId);
            tokens.revokeUser(userId, now);
        });
    }
}
