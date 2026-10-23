package kr.co.fitdining.api.auth.infrastructure;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Set;
import org.springframework.core.env.Environment;

/**
 * Validated web-only settings; optional credentials are absent together.
 * @param signingKey decoded signing key, never logged
 * @param origin allowed frontend origin
 * @param cookieSecure cookie Secure policy
 * @param demoUsername optional demo name, null when seeding is disabled
 * @param demoPassword optional demo password, null when seeding is disabled
 */
public record AuthSettings(byte[] signingKey, String origin, boolean cookieSecure,
        String demoUsername, String demoPassword) {
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
        String username = environment.getProperty("AUTH_DEMO_USERNAME");
        String password = environment.getProperty("AUTH_DEMO_PASSWORD");
        if (username != null || password != null) {
            if (username == null || username.isBlank() || username.length() > 100 || password == null
                    || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
                throw new IllegalArgumentException("Both demo credentials are required; password length must be valid");
            }
        }
        return new AuthSettings(key, origin, Boolean.parseBoolean(secure), username, password);
    }

    /** Prevents accidental credential disclosure through record-generated logging. */
    @Override public String toString() { return "AuthSettings[redacted]"; }
}
