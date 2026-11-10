package kr.co.fitdining.api.auth.application;

import kr.co.fitdining.api.auth.ports.AuthPolicy;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthLoginAttempt;
import kr.co.fitdining.api.auth.domain.AuthSecurityEvent;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;
import kr.co.fitdining.api.auth.repository.AuthLoginAttemptRepository;
import kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Short database transactions; password hashing and verification never run here. */
@Service
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class AuthTransactions {
    private final AuthLoginAttemptRepository attempts;
    private final AuthSecurityEventRepository events;
    private final AuthUserRepository users;
    private final kr.co.fitdining.api.auth.repository.AuthEmailVerificationRepository verifications;
    private final kr.co.fitdining.api.user.UserPreferencesRepository preferences;
    private final Clock clock;
    private final AuthPolicy policy;
    @org.springframework.beans.factory.annotation.Value("${auth.terms-version}")
    private String termsVersion;

    /**
     * Consumes the email verification token, then saves the account atomically,
     * after transaction-free hashing. A concurrent request with the same token updates zero rows and rolls back.
     * @param verificationTokenHash hash checked by {@link EmailVerifications#requireToken}
     */
    @Transactional
    public Issued signup(String email, String nickname, String hash, String verificationTokenHash,
            kr.co.fitdining.api.user.Preferences answers, kr.co.fitdining.api.onboarding.TasteProfileService.Profile profile) {
        Instant now = clock.instant();
        if (verifications.consume(verificationTokenHash, email, now) != 1)
            throw kr.co.fitdining.api.auth.domain.EmailVerificationFailure.required();
        AuthUser created = new AuthUser(UUID.randomUUID().toString(), email, nickname, hash, now, termsVersion);
        created.markEmailVerified(now);
        AuthUser user = users.saveAndFlush(created);
        if (answers != null) preferences.saveAndFlush(new kr.co.fitdining.api.user.UserPreferences(user.getId(), answers, now, profile.features(), profile.tastes()));
        return login(user);
    }

    /** Records a login attempt only while the per-address window is below its limit. */
    @Transactional
    public boolean recordAttempt(String address, String action) {
        if (!policy.limitAttempts()) return true;
        Instant now = clock.instant();
        attempts.lockAddress(address + ":" + action);
        if (attempts.countByAddressAndActionAndCreatedAtAfter(address, action, now.minusSeconds(900)) >= 20) return false;
        attempts.save(new AuthLoginAttempt(address, action, now));
        return true;
    }

    /** Creates the identity and absolute expiry for a new session. */
    @Transactional
    public Issued login(AuthUser user) {
        user = activeUser(user.getId());
        return new Issued(new Identity(user.getId(), user.getNickname(),
                clock.instant().getEpochSecond() + policy.sessionSeconds()));
    }

    @Transactional
    public void audit(String userId, String type) {
        events.save(AuthSecurityEvent.login(userId, clock.instant(), type));
    }

    /** Inserts a missing demo account; a concurrent unique conflict is handled outside the transaction. */
    @Transactional
    public void seedUser(String email, String nickname, String passwordHash) {
        if (users.findByEmail(email).isEmpty()) {
            // The demo account is created from server configuration without a verification code.
            AuthUser demo = new AuthUser(UUID.randomUUID().toString(), email, nickname, passwordHash, clock.instant(), termsVersion);
            demo.markEmailVerified(clock.instant());
            users.saveAndFlush(demo);
        }
    }

    /** Checks a concurrent seed conflict in a fresh transaction. */
    @Transactional(readOnly = true)
    public boolean demoUserExists(String email) { return users.findByEmail(email).isPresent(); }

    private AuthUser activeUser(String id) {
        return users.lockById(id).filter(user -> user.getDeletedAt() == null).orElseThrow(AuthTransactions::invalid);
    }

    private static AuthFailure invalid() { return new AuthFailure("인증을 확인해주세요."); }

}
