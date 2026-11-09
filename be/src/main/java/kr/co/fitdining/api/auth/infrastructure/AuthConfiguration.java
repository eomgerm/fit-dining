package kr.co.fitdining.api.auth.infrastructure;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
import java.time.Clock;
import java.util.UUID;
import kr.co.fitdining.api.auth.application.AuthTransactions;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.ports.TokenCodec;
import kr.co.fitdining.api.auth.ports.VerificationMailer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.ApplicationRunner;
import org.springframework.mail.javamail.JavaMailSender;
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
    /**
     * SMTP 호스트가 있으면 SMTP, 없으면 로그 발송기를 쓴다(D6).
     * 로그 발송기는 인증번호를 로그에 남기므로 prod에서는 기동을 거부한다.
     */
    @Bean VerificationMailer verificationMailer(Environment environment, ObjectProvider<JavaMailSender> senders) {
        String host = environment.getProperty("spring.mail.host", "").trim();
        if (host.isEmpty()) {
            if (isProd(environment))
                throw new IllegalStateException("SPRING_MAIL_HOST is required in prod; the logging verification mailer is not allowed");
            log.warn("Logging verification mailer is enabled; verification codes are written to the log");
            return new LoggingVerificationMailer();
        }
        String from = environment.getProperty("auth.mail.from", "").trim();
        for (String key : new String[]{"spring.mail.host", "spring.mail.username", "spring.mail.password", "auth.mail.from"}) {
            String value = environment.getProperty(key, "");
            if (value.isBlank() || value.trim().equals("REPLACE_ME"))
                throw new IllegalArgumentException("SMTP mail settings must all be set together: " + key);
        }
        if (!kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("email", from.toLowerCase(java.util.Locale.ROOT)))
            throw new IllegalArgumentException("AUTH_MAIL_FROM must be an email address");
        JavaMailSender sender = senders.getIfAvailable();
        if (sender == null) throw new IllegalStateException("JavaMailSender is not configured although SPRING_MAIL_HOST is set");
        return new SmtpVerificationMailer(sender, from, environment.getProperty("auth.mail.from-name", "핏다이닝"));
    }
    static boolean isProd(Environment environment) {
        return "prod".equals(environment.getProperty("APP_ENV")) || environment.matchesProfiles("prod");
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
