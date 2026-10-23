package kr.co.fitdining.api.auth.application;

import java.nio.charset.StandardCharsets;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.ports.TokenCodec;
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
    private final AuthUserRepository users;
    private final PasswordHasher passwords;
    private final TokenCodec codec;
    private final String authDummyHash;

    @Override
    public Issued login(String username, String password, String address) {
        if (username == null || username.isBlank() || username.length() > 100 || password == null
                || password.isEmpty() || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new AuthFailure("입력 형식을 확인해주세요.", 400);
        }
        if (!transactions.recordAttempt(address)) throw new AuthFailure("잠시 후 다시 시도해주세요.", 429);
        AuthUser user = users.findByUsername(username).orElse(null);
        boolean matches = passwords.matches(password, user == null ? authDummyHash : user.getPasswordHash());
        if (user == null || !matches) throw new AuthFailure("인증을 확인해주세요.");
        return transactions.login(user);
    }

    @Override
    public Issued refresh(String value) {
        TokenCodec.Claims claims = codec.decode(value, "refresh");
        AuthTransactions.Rotation result = transactions.rotate(claims);
        if (result.failure() != null) {
            transactions.revokeReused(claims);
            throw result.failure();
        }
        return result.issued();
    }

    /** Stateless verification deliberately performs no repository access or transaction. */
    @Override
    public Identity authenticate(String value) {
        TokenCodec.Claims claims = codec.decode(value, "access");
        return new Identity(claims.userId(), claims.username(), claims.sessionId(),
                claims.expiresAt(), claims.sessionExpiresAt());
    }

    @Override
    public void logout(Identity identity) { transactions.logout(identity); }
}
