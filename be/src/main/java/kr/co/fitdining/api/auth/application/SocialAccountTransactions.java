package kr.co.fitdining.api.auth.application;

import java.time.Clock;
import java.util.UUID;
import kr.co.fitdining.api.auth.domain.*;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;
import kr.co.fitdining.api.auth.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Atomic identity creation, serialized even when the identity row does not yet exist. */
@Service
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class SocialAccountTransactions {
    private final AuthSocialAccountRepository accounts;
    private final AuthUserRepository users;
    private final AuthLoginAttemptRepository locks;
    private final AuthTransactions transactions;
    private final Clock clock;
    private final kr.co.fitdining.api.user.UserPreferencesRepository preferences;
    @Value("${auth.terms-version}")
    private String termsVersion;

    @Transactional
    public Issued existing(String provider, String subject) {
        return accounts.findById(new AuthSocialAccount.Key(provider, subject))
            .map(account -> transactions.login(users.findById(account.getUserId()).orElseThrow())).orElse(null);
    }

    @Transactional
    public Issued signup(String provider, String subject, String nickname, kr.co.fitdining.api.user.Preferences answers) {
        return signup(provider, subject, nickname, answers, java.util.List.of());
    }

    @Transactional
    public Issued signup(String provider, String subject, String nickname, kr.co.fitdining.api.user.Preferences answers,
            java.util.List<kr.co.fitdining.api.user.TasteFeature> features) {
        locks.lockAddress("social:" + provider + ":" + subject);
        Issued existing = existing(provider, subject);
        if (existing != null) return existing;
        if (users.existsByNickname(nickname)) throw new SignupConflict("nickname");
        AuthUser user = users.saveAndFlush(new AuthUser(UUID.randomUUID().toString(), nickname, clock.instant(), termsVersion));
        accounts.saveAndFlush(new AuthSocialAccount(new AuthSocialAccount.Key(provider, subject), user.getId(), clock.instant()));
        if (answers != null) preferences.saveAndFlush(new kr.co.fitdining.api.user.UserPreferences(user.getId(), answers, clock.instant(), features));
        return transactions.login(user);
    }
}
