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
    @org.springframework.beans.factory.annotation.Value("${auth.terms-version}")
    private String termsVersion;

    /** Saves the account and initial RT atomically, after transaction-free hashing. */
    @Transactional
    public Issued signup(String email, String nickname, String hash) {
        AuthUser user = users.saveAndFlush(new AuthUser(UUID.randomUUID().toString(), email, nickname,
                hash, clock.instant(), termsVersion));
        return login(user);
    }

    /** Records a login attempt only while the per-address window is below its limit. */
    @Transactional
    public boolean recordAttempt(String address, String action) {
        Instant now = clock.instant();
        attempts.lockAddress(address + ":" + action);
        if (attempts.countByAddressAndActionAndCreatedAtAfter(address, action, now.minusSeconds(900)) >= 20) return false;
        attempts.save(new AuthLoginAttempt(address, action, now));
        return true;
    }

    /** Creates one refresh family and persists its first RT only. */
    @Transactional
    public Issued login(AuthUser user) {
        Instant now = clock.instant();
        return issue(user.getId(), user.getNickname(), UUID.randomUUID().toString(), now.plusSeconds(86400), now);
    }

    /**
     * Returns reuse as a value so the RT row lock is released before acquiring a family lock.
     * @param claims verified refresh claims
     * @return issued tokens or a generic authentication failure
     */
    @Transactional
    public Rotation rotate(TokenCodec.Claims claims) {
        AuthRefreshToken token = refreshTokens.lockByJti(claims.jti()).orElseThrow(AuthTransactions::invalid);
        if (!token.getUserId().equals(claims.userId())
                || token.getExpiresAt().getEpochSecond() != claims.expiresAt()) throw invalid();
        Instant now = clock.instant();
        if (token.getUsedAt() != null || token.getRevokedAt() != null) {
            return new Rotation(null, invalid());
        }
        if (!token.getExpiresAt().isAfter(now)) throw invalid();
        token.markUsed(now);
        return new Rotation(issue(token.getUserId(), users.findById(token.getUserId()).orElseThrow(AuthTransactions::invalid).getNickname(), token.getFamilyId(), token.getExpiresAt(), now), null);
    }

    /**
     * Records a previously verified replay in its own transaction, after rotate released its row lock.
     * Family serialization makes revocation and the event counter atomic across different old RTs.
     * @param claims refresh claims already checked against the locked RT by rotate
     */
    @Transactional
    public void revokeReused(TokenCodec.Claims claims) {
        Instant now = clock.instant();
        AuthRefreshToken token = refreshTokens.findById(claims.jti()).orElseThrow(AuthTransactions::invalid);
        String family = token.getFamilyId();
        revokeFamily(family, claims.userId(), now, "REFRESH_REUSE");
        int count = Math.toIntExact(events.countByFamilyId(family) + 1);
        events.save(new AuthSecurityEvent(family, now,
                count >= 3 ? "ATTACK_DETECTED" : "REFRESH_REUSE", count));
    }

    /** Revokes the cookie RT's family; issued ATs remain valid until expiry. */
    @Transactional
    public void logout(TokenCodec.Claims claims) {
        refreshTokens.findById(claims.jti()).filter(t -> t.getUserId().equals(claims.userId()))
                .ifPresent(t -> revokeFamily(t.getFamilyId(), t.getUserId(), clock.instant(), "LOGOUT"));
    }

    /** Inserts a missing demo account; a concurrent unique conflict is handled outside the transaction. */
    @Transactional
    public void seedUser(String email, String nickname, String passwordHash) {
        if (users.findByEmail(email).isEmpty()) {
            users.saveAndFlush(new AuthUser(UUID.randomUUID().toString(), email, nickname, passwordHash, clock.instant(), termsVersion));
        }
    }

    /** Checks a concurrent seed conflict in a fresh transaction. */
    @Transactional(readOnly = true)
    public boolean demoUserExists(String email) { return users.findByEmail(email).isPresent(); }

    private void revokeFamily(String family, String user, Instant now, String reason) {
        // Never enter while holding a presented-RT lock: every revoker takes the family lock first.
        refreshTokens.lockFamily(family);
        do {
            refreshTokens.revokeFamily(family, user, now, reason);
            // A concurrent rotation can insert a successor while the bulk update waits on its parent.
            // Recheck with a fresh READ COMMITTED snapshot before considering revocation complete.
        } while (refreshTokens.existsByFamilyIdAndUserIdAndRevokedAtIsNull(family, user));
    }

    private Issued issue(String user, String nickname, String family, Instant familyExpiry, Instant now) {
        long created = now.getEpochSecond();
        long expiry = familyExpiry.getEpochSecond();
        long accessExpiry = Math.min(created + 1800, expiry);
        String jti = UUID.randomUUID().toString();
        refreshTokens.save(new AuthRefreshToken(jti, family, user, now, familyExpiry));
        String at = codec.encode(new TokenCodec.Token(user, null, "access", created, accessExpiry));
        String rt = codec.encode(new TokenCodec.Token(user, jti, "refresh", created, expiry));
        return new Issued(at, rt, new Identity(user, nickname, family, accessExpiry, expiry));
    }

    private static AuthFailure invalid() { return new AuthFailure("인증을 확인해주세요."); }

    /**
     * @param issued new tokens, absent when rejected
     * @param failure generic failure, absent on success
     */
    public record Rotation(Issued issued, AuthFailure failure) {}
}
