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
    private final kr.co.fitdining.api.onboarding.TasteProfileService tasteProfiles;
    private final AuthUserRepository users;
    private final SocialNicknames nicknames;

    public Issued existing(String provider, String subject) {
        return transactions.existing(provider, subject);
    }

    public Issued existing(String provider, String subject, String providerEmail) {
        return transactions.existing(provider, subject, providerEmail);
    }

    public Issued signup(String provider, String subject, kr.co.fitdining.api.user.Preferences preferences,
            String email, String tokenHash, boolean marketing) {
        var profile = tasteProfiles.compute(preferences);
        for (int attempt = 0; attempt < 10; attempt++) {
            String nickname = nicknames.next(attempt);
            try {
                return transactions.signup(provider, subject, nickname, preferences, profile, email, tokenHash, marketing);
            } catch (SignupConflict conflict) {
                if (!"nickname".equals(conflict.field())) throw conflict;
            } catch (DataIntegrityViolationException conflict) {
                if (!users.existsByNickname(nickname)) throw conflict;
            }
        }
        throw new IllegalStateException("Could not allocate a social nickname after 10 attempts");
    }
}
