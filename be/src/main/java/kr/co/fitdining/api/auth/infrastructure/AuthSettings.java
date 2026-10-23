package kr.co.fitdining.api.auth.infrastructure;

import java.net.URI;
import java.util.Base64;
import java.util.Set;
import org.springframework.core.env.Environment;

/**
 * Validated web-only settings; optional credentials are absent together.
 * @param signingKey decoded signing key, never logged
 * @param origin allowed frontend origin
 * @param cookieSecure cookie Secure policy
 * @param demoEmail optional demo name, null when seeding is disabled
 * @param demoPassword optional demo password, null when seeding is disabled
 * @param demoNickname optional public name, null when seeding is disabled
 */
public record AuthSettings(byte[] signingKey, String origin, boolean cookieSecure,
        String demoEmail, String demoPassword, String demoNickname) {
    /** Loads mandatory settings without defaults; no auth settings are read by migrate. */
    public static AuthSettings load(Environment environment) {
        byte[] key = Base64.getDecoder().decode(environment.getRequiredProperty("auth.jwt-secret"));
        if (key.length < 32) throw new IllegalArgumentException("JWT_SECRET requires at least 32 decoded bytes");
        String origin = environment.getRequiredProperty("auth.frontend-origin");
        URI uri = URI.create(origin);
        if (origin.isBlank() || uri.getHost() == null || !Set.of("http", "https").contains(uri.getScheme())
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())) {
            throw new IllegalArgumentException("A valid frontend origin is required");
        }
        String secure = environment.getRequiredProperty("auth.cookie-secure");
        if (!Set.of("true", "false").contains(secure)) throw new IllegalArgumentException("Cookie secure must be true or false");
        String email = environment.getProperty("AUTH_DEMO_EMAIL");
        String nickname = environment.getProperty("AUTH_DEMO_NICKNAME");
        String password = environment.getProperty("AUTH_DEMO_PASSWORD");
        if (email != null || password != null || nickname != null) {
            if (email == null || nickname == null
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("email", kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email))
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("nickname", kr.co.fitdining.api.auth.domain.AuthText.strip(nickname))
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("password", password)) {
                throw new IllegalArgumentException("All three demo account settings are required and must satisfy signup rules");
            }
        }
        return new AuthSettings(key, origin, Boolean.parseBoolean(secure), email == null ? null : kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email), password, kr.co.fitdining.api.auth.domain.AuthText.strip(nickname));
    }

    /** Prevents accidental credential disclosure through record-generated logging. */
    @Override public String toString() { return "AuthSettings[redacted]"; }
}
