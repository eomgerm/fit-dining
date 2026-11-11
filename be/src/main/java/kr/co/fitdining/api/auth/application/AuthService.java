package kr.co.fitdining.api.auth.application;

import kr.co.fitdining.api.auth.ports.AuthPolicy;
import java.nio.charset.StandardCharsets;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;

/** Orchestrates independent short transactions around transaction-free BCrypt work. */
@Service
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class AuthService implements AuthUseCases {
    private final AuthTransactions transactions;
    private final kr.co.fitdining.api.onboarding.TasteProfileService tasteProfiles;
    private final AuthUserRepository users;
    private final PasswordHasher passwords;
    private final String authDummyHash;
    private final AuthPolicy policy;
    private final EmailVerifications verifications;

    @Override
    public Issued login(String email, String password, String address) {
        if (email == null || normalizeEmail(email).isBlank() || normalizeEmail(email).length() > 254 || password == null
                || password.isEmpty() || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new AuthFailure("입력 형식을 확인해주세요.", 400);
        }
        if (!transactions.recordAttempt(address, "login")) throw new AuthFailure("잠시 후 다시 시도해주세요.", 429);
        try {
            AuthUser user = users.findByEmail(normalizeEmail(email)).orElse(null);
            if (user == null && !policy.compareDummyPassword()) throw new AuthFailure("인증을 확인해주세요.");
            boolean matches = passwords.matches(password, user == null ? authDummyHash : user.getPasswordHash());
            if (user == null || !matches || user.getDeletedAt() != null) throw new AuthFailure("인증을 확인해주세요.");
            return transactions.login(user);
        } catch (AuthFailure rejected) {
            if (rejected.status() == 401) transactions.audit(null, "LOGIN_FAILURE");
            throw rejected;
        }
    }

    @Override
    public void logout(String userId) { if (userId != null) transactions.audit(userId, "LOGOUT"); }

    @Override
    public void sessionEstablished(String userId) { transactions.audit(userId, "LOGIN_SUCCESS"); }

    @Override
    public Profile me(String userId) {
        AuthUser user = users.findById(userId).filter(value -> value.getDeletedAt() == null).orElseThrow(() -> new AuthFailure("인증을 확인해주세요."));
        return new Profile(user.getNickname(), user.getEmail());
    }

    @Override
    public Issued signup(String email, String password, String nickname, String verificationToken, String address) {
        return signup(email, password, nickname, verificationToken, address, null);
    }

    @Override
    public Issued signup(String email, String password, String nickname, String verificationToken, String address,
            kr.co.fitdining.api.user.Preferences preferences) {
        return signup(email, password, nickname, verificationToken, address, preferences, false);
    }

    @Override
    public Issued signup(String email, String password, String nickname, String verificationToken, String address,
            kr.co.fitdining.api.user.Preferences preferences, boolean marketing) {
        if (!transactions.recordAttempt(address, "signup")) throw new AuthFailure("잠시 후 다시 시도해주세요.", 429);
        String normalized = normalizeEmail(email);
        String name = kr.co.fitdining.api.auth.domain.AuthText.strip(nickname);
        if (users.findByEmail(normalized).isPresent()) throw new kr.co.fitdining.api.auth.domain.SignupConflict("email");
        if (users.existsByNickname(name)) throw new kr.co.fitdining.api.auth.domain.SignupConflict("nickname");
        String tokenHash = verifications.requireToken(normalized, verificationToken);
        String hash = passwords.hash(password);
        var profile = tasteProfiles.compute(preferences);
        try { return transactions.signup(normalized, name, hash, tokenHash, preferences, profile, marketing); }
        catch (org.springframework.dao.DataIntegrityViolationException conflict) {
            if (users.findByEmail(normalized).isPresent()) throw new kr.co.fitdining.api.auth.domain.SignupConflict("email");
            if (users.existsByNickname(name)) throw new kr.co.fitdining.api.auth.domain.SignupConflict("nickname");
            throw conflict;
        }
    }

    public static String normalizeEmail(String email) { return kr.co.fitdining.api.auth.domain.AuthText.strip(email).toLowerCase(java.util.Locale.ROOT); }
}
