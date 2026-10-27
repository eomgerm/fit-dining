package kr.co.fitdining.api.auth.infrastructure;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
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
@lombok.extern.slf4j.Slf4j
public class AuthConfiguration {
    @Bean
    @ConditionalOnBooleanProperty(name = "auth.simple.enabled", havingValue = false, matchIfMissing = true)
    AuthPolicy strictAuthPolicy() { return new StrictAuthPolicy(); }
    @Bean
    @ConditionalOnBooleanProperty(name = "auth.simple.enabled")
    AuthPolicy simpleAuthPolicy(Environment environment) {
        return new SimpleAuthPolicy(AuthSettings.isLocal(environment));
    }
    @Bean AuthSettings authSettings(Environment environment) { return AuthSettings.load(environment); }
    @Bean Clock authClock() { return Clock.systemUTC(); }
    @Bean AuthWebConfiguration authWebConfiguration(AuthUseCases auth, AuthSettings settings, AuthPolicy policy) {
        return new AuthWebConfiguration(auth, settings.origin(), Boolean.toString(settings.cookieSecure()), policy);
    }
    @Bean
    @ConditionalOnBooleanProperty(name = "auth.simple.enabled", havingValue = false, matchIfMissing = true)
    PasswordHasher passwordHasher() { return bcrypt(12); }
    @Bean
    @ConditionalOnBooleanProperty(name = "auth.simple.enabled")
    PasswordHasher simplePasswordHasher() { return bcrypt(4); }
    private PasswordHasher bcrypt(int cost) {
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(cost);
        return new PasswordHasher() {
            @Override public String hash(String password) { return encoder.encode(password); }
            @Override public boolean matches(String password, String hash) { return encoder.matches(password, hash); }
        };
    }
    @Bean String authDummyHash(PasswordHasher passwords, AuthPolicy policy) {
        return policy.compareDummyPassword() ? passwords.hash(UUID.randomUUID().toString()) : "";
    }
    @Bean TokenCodec tokenCodec(AuthSettings settings, Clock clock) {
        return new NimbusTokenCodec(settings.signingKey(), clock);
    }
    @Bean ApplicationRunner seedDemoUser(AuthSettings settings, PasswordHasher passwords, AuthTransactions transactions) {
        return args -> {
            if (settings.simpleEnabled()) log.warn("Simple authentication mode is enabled");
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
