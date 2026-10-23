package kr.co.fitdining.api.auth.infrastructure;

import java.time.Clock;
import java.util.UUID;
import kr.co.fitdining.api.auth.application.AuthTransactions;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.ports.TokenCodec;
import kr.co.fitdining.api.auth.presentation.AuthWebConfiguration;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Auth infrastructure is created only for the servlet web application, never for migrations. */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableScheduling
public class AuthConfiguration {
    @Bean AuthSettings authSettings(Environment environment) { return AuthSettings.load(environment); }
    @Bean Clock authClock() { return Clock.systemUTC(); }
    @Bean AuthWebConfiguration authWebConfiguration(AuthUseCases auth, AuthSettings settings) {
        return new AuthWebConfiguration(auth, settings.origin(), Boolean.toString(settings.cookieSecure()));
    }
    @Bean PasswordHasher passwordHasher() {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);
        return new PasswordHasher() {
            @Override public String hash(String password) { return encoder.encode(password); }
            @Override public boolean matches(String password, String hash) { return encoder.matches(password, hash); }
        };
    }
    @Bean String authDummyHash(PasswordHasher passwords) { return passwords.hash(UUID.randomUUID().toString()); }
    @Bean TokenCodec tokenCodec(AuthSettings settings, Clock clock) {
        return new NimbusTokenCodec(settings.signingKey(), clock);
    }
    @Bean ApplicationRunner seedDemoUser(AuthSettings settings, PasswordHasher passwords, AuthTransactions transactions) {
        return args -> {
            if (settings.demoEmail() == null) return;
            String hash = passwords.hash(settings.demoPassword());
            try {
                transactions.seedUser(settings.demoEmail(), settings.demoNickname(), hash);
            } catch (DataIntegrityViolationException conflict) {
                // Another web instance may have inserted the same unique email during startup.
                // Verify that the expected account exists; unrelated constraint failures must still fail startup.
                if (!transactions.demoUserExists(settings.demoEmail())) throw conflict;
            }
        };
    }
}
