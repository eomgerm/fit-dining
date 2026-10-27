package kr.co.fitdining.api.auth.application;

import kr.co.fitdining.api.auth.domain.SignupConflict;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/** Resolves concurrent nickname conflicts after the failed creation transaction has rolled back. */
@Service
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class SocialAccounts {
    private final SocialAccountTransactions transactions;
    private final AuthUserRepository users;

    public Issued existing(String provider, String subject) {
        return transactions.existing(provider, subject);
    }

    public Issued signup(String provider, String subject, String nickname) {
        return signup(provider, subject, nickname, null);
    }

    public Issued signup(String provider, String subject, String nickname, kr.co.fitdining.api.user.Preferences preferences) {
        try {
            return transactions.signup(provider, subject, nickname, preferences);
        } catch (DataIntegrityViolationException conflict) {
            if (users.existsByNickname(nickname)) throw new SignupConflict("nickname");
            throw conflict;
        }
    }
}
