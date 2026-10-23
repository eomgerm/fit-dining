package kr.co.fitdining.api.auth.application;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthLoginAttempt;
import kr.co.fitdining.api.auth.domain.AuthRefreshToken;
import kr.co.fitdining.api.auth.domain.AuthSecurityEvent;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;
import kr.co.fitdining.api.auth.ports.TokenCodec;
import kr.co.fitdining.api.auth.repository.AuthLoginAttemptRepository;
import kr.co.fitdining.api.auth.repository.AuthRefreshTokenRepository;
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
    private final AuthRefreshTokenRepository refreshTokens;
    private final AuthSecurityEventRepository events;
    private final AuthUserRepository users;
    private final TokenCodec codec;
    private final Clock clock;

    /** Records a login attempt only while the per-address window is below its limit. */
    @Transactional
    public boolean recordAttempt(String address) {
        Instant now = clock.instant();
        attempts.lockAddress(address);
        if (attempts.countByAddressAndCreatedAtAfter(address, now.minusSeconds(900)) >= 20) return false;
        attempts.save(new AuthLoginAttempt(address, now));
        return true;
    }

    /** Creates one refresh family and persists its first RT only. */
    @Transactional
    public Issued login(AuthUser user) {
        Instant now = clock.instant();
        return issue(user.getId(), user.getUsername(), UUID.randomUUID().toString(), now.plusSeconds(86400), now);
    }

    /**
     * Returns reuse as a value so the RT row lock is released before acquiring a family lock.
     * @param claims verified refresh claims
     * @return issued tokens or a generic authentication failure
     */
    @Transactional
    public Rotation rotate(TokenCodec.Claims claims) {
        AuthRefreshToken token = refreshTokens.lockByJti(claims.jti()).orElseThrow(AuthTransactions::invalid);
        if (!token.getFamilyId().equals(claims.sessionId()) || !token.getUserId().equals(claims.userId())
                || token.getExpiresAt().getEpochSecond() != claims.expiresAt()) throw invalid();
        Instant now = clock.instant();
        if (token.getUsedAt() != null || token.getRevokedAt() != null) {
            return new Rotation(null, invalid());
        }
        if (!token.getExpiresAt().isAfter(now)) throw invalid();
        token.markUsed(now);
        return new Rotation(issue(token.getUserId(), claims.username(), token.getFamilyId(), token.getExpiresAt(), now), null);
    }

    /**
     * Records a previously verified replay in its own transaction, after rotate released its row lock.
     * Family serialization makes revocation and the event counter atomic across different old RTs.
     * @param claims refresh claims already checked against the locked RT by rotate
     */
    @Transactional
    public void revokeReused(TokenCodec.Claims claims) {
        Instant now = clock.instant();
        revokeFamily(claims.sessionId(), claims.userId(), now, "REFRESH_REUSE");
        int count = Math.toIntExact(events.countByFamilyId(claims.sessionId()) + 1);
        events.save(new AuthSecurityEvent(claims.sessionId(), now,
                count >= 3 ? "ATTACK_DETECTED" : "REFRESH_REUSE", count));
    }

    /** Revokes only the Bearer token's refresh family; issued ATs remain valid until expiry. */
    @Transactional
    public void logout(Identity identity) {
        revokeFamily(identity.sessionId(), identity.userId(), clock.instant(), "LOGOUT");
    }

    /** Inserts a missing demo account; a concurrent unique conflict is handled outside the transaction. */
    @Transactional
    public void seedUser(String username, String passwordHash) {
        if (users.findByUsername(username).isEmpty()) {
            users.saveAndFlush(new AuthUser(UUID.randomUUID().toString(), username, passwordHash, clock.instant()));
        }
    }

    /** Checks a concurrent seed conflict in a fresh transaction. */
    @Transactional(readOnly = true)
    public boolean demoUserExists(String username) { return users.findByUsername(username).isPresent(); }

    private void revokeFamily(String family, String user, Instant now, String reason) {
        // Never enter while holding a presented-RT lock: every revoker takes the family lock first.
        refreshTokens.lockFamily(family);
        do {
            refreshTokens.revokeFamily(family, user, now, reason);
            // A concurrent rotation can insert a successor while the bulk update waits on its parent.
            // Recheck with a fresh READ COMMITTED snapshot before considering revocation complete.
        } while (refreshTokens.existsByFamilyIdAndUserIdAndRevokedAtIsNull(family, user));
    }

    private Issued issue(String user, String username, String family, Instant familyExpiry, Instant now) {
        long created = now.getEpochSecond();
        long expiry = familyExpiry.getEpochSecond();
        long accessExpiry = Math.min(created + 1800, expiry);
        String jti = UUID.randomUUID().toString();
        refreshTokens.save(new AuthRefreshToken(jti, family, user, now, familyExpiry));
        String at = codec.encode(new TokenCodec.Token(user, username, family, UUID.randomUUID().toString(),
                "access", created, accessExpiry, expiry));
        String rt = codec.encode(new TokenCodec.Token(user, username, family, jti, "refresh", created, expiry, expiry));
        return new Issued(at, rt, new Identity(user, username, family, accessExpiry, expiry));
    }

    private static AuthFailure invalid() { return new AuthFailure("인증을 확인해주세요."); }

    /**
     * @param issued new tokens, absent when rejected
     * @param failure generic failure, absent on success
     */
    public record Rotation(Issued issued, AuthFailure failure) {}
}
