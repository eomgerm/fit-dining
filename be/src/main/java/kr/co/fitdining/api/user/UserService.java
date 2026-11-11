package kr.co.fitdining.api.user;

import java.time.Clock;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.searchthread.SearchThreadService;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.transaction.annotation.Transactional;

/** Serializes withdrawal with login through the account row lock. */
@Service @ConditionalOnWebApplication @RequiredArgsConstructor
public class UserService {
    private final AuthUserRepository users;
    private final UserPreferencesRepository preferences;
    private final Clock clock;
    private final kr.co.fitdining.api.auth.repository.AuthSocialAccountRepository socialAccounts;
    private final SearchThreadService searchThreads;
    private final kr.co.fitdining.api.auth.infrastructure.AccountSessions accountSessions;
    private final kr.co.fitdining.api.auth.application.EmailVerifications verifications;
    private final kr.co.fitdining.api.auth.repository.AuthEmailVerificationRepository emailVerifications;
    public record Profile(String userId, String nickname, String loginMethod,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS) String contactEmail,
            boolean marketingAgreed) {}
    @Transactional(readOnly = true)
    public Profile profile(String userId, Identity identity) {
        requireOwner(userId, identity);
        var user = users.findById(userId).filter(value -> value.getDeletedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "사용자 정보가 없습니다."));
        String method = socialAccounts.findByUserId(userId)
                .map(account -> account.getId().getProvider()).orElse("email");
        return new Profile(user.getId(), user.getNickname(), method, user.getContactEmail(), user.getMarketingAgreedAt() != null);
    }
    @Transactional(readOnly = true)
    public UserPreferences preferences(String userId, Identity identity) {
        requireOwner(userId, identity);
        if (!users.existsByIdAndDeletedAtIsNull(userId))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다.");
        return preferences.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다."));
    }
    @Transactional
    public void contactEmail(String userId, Identity identity, String email, String token) {
        requireOwner(userId, identity);
        // consume clears the persistence context, so acquire the user after consuming the token.
        String hash = verifications.requireToken(email, token);
        if (emailVerifications.consume(hash, email, clock.instant()) != 1)
            throw kr.co.fitdining.api.auth.domain.EmailVerificationFailure.required();
        activeUser(userId).changeContactEmail(email, clock.instant());
    }

    @Transactional
    public void marketingConsent(String userId, Identity identity, boolean agreed) {
        requireOwner(userId, identity);
        activeUser(userId).marketingConsent(agreed, clock.instant());
    }

    private kr.co.fitdining.api.auth.domain.AuthUser activeUser(String userId) {
        return users.lockById(userId).filter(user -> user.getDeletedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "사용자 정보가 없습니다."));
    }

    private void requireOwner(String userId, Identity identity) {
        if (!userId.equals(identity.userId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "접근 권한이 없습니다.");
    }
    @Transactional
    public void withdraw(String userId, Identity identity) {
        requireOwner(userId, identity);
        accountSessions.invalidateAfterCommit(userId);
        users.lockById(userId).ifPresent(user -> {
            if (user.getDeletedAt() != null) return;
            var now = clock.instant();
            user.withdraw(now);
            socialAccounts.deleteByUserId(userId);
            preferences.deleteById(userId);
            // Search history holds copies of the query, taste tags and map area (search-thread D-13)
            searchThreads.deleteAll(userId);
        });
    }
}
