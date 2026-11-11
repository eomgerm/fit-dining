package kr.co.fitdining.api.auth.infrastructure;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Base64;
import java.util.Objects;
import java.util.Set;
import org.springframework.core.env.Environment;

/**
 * Validated web-only settings; optional credentials are absent together.
 * @param simpleEnabled whether development authentication is enabled
 * @param devKey optional local key, mandatory on dev servers, never logged
 * @param signingKey decoded signing key, never logged
 * @param origin allowed frontend origin
 * @param cookieSecure cookie Secure policy
 * @param demoEmail optional demo name, null when seeding is disabled
 * @param demoPassword optional demo password, null when seeding is disabled
 * @param demoNickname optional public name, null when seeding is disabled
 */
public record AuthSettings(byte[] signingKey, String origin, boolean cookieSecure,
        String demoEmail, String demoPassword, String demoNickname, boolean simpleEnabled, String devKey) {
    public AuthSettings(byte[] key, String origin, boolean secure, String email, String password, String nickname) {
        this(key, origin, secure, email, password, nickname, false, null);
    }

    /** Uses the same local boundary as the environment contract validator. */
    public static boolean isLocal(Environment environment) {
        return environment.getProperty("APP_ENV") == null && java.util.Arrays.stream(environment.getActiveProfiles())
                .noneMatch(Set.of("dev", "prod", "migrate")::contains);
    }
    /** Loads validated settings with development defaults only in simple local mode. */
    public static AuthSettings load(Environment environment) {
        boolean simple = environment.getProperty("auth.simple.enabled", Boolean.class, false);
        boolean local = isLocal(environment);
        String devKey = environment.getProperty("auth.simple.dev-key", environment.getProperty("AUTH_DEV_KEY"));
        if (devKey != null && devKey.isBlank()) devKey = null;
        if (simple && !local && (devKey == null || devKey.equals("REPLACE_ME")))
            throw new IllegalArgumentException("AUTH_DEV_KEY is required for simple authentication on servers");
        if (simple && !local && devKey.length() < 32)
            throw new IllegalArgumentException("AUTH_DEV_KEY requires at least 32 characters on servers");
        String secret = environment.getProperty("auth.jwt-secret", "");
        byte[] key = simple && local && secret.isBlank()
                ? localSigningKey() : Base64.getDecoder().decode(secret);
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
        if (simple) {
            if (email == null || email.isBlank()) email = "dev@fitdining.local";
            if (nickname == null || nickname.isBlank()) nickname = "개발자";
            // Demo default for simple local mode only; the validation below rejects missing passwords on servers.
            if (local && (password == null || password.isBlank())) password = "fitdining-dev1";
            if (!local && (password == null || password.isBlank() || password.equals("REPLACE_ME")))
                throw new IllegalArgumentException("AUTH_DEMO_PASSWORD is required for simple authentication on servers");
        }
        if (email != null || password != null || nickname != null) {
            if (email == null || nickname == null
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("email", kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email))
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("nickname", kr.co.fitdining.api.auth.domain.AuthText.strip(nickname))
                    || !kr.co.fitdining.api.auth.presentation.SignupValue.Validator.valid("password", password)) {
                throw new IllegalArgumentException("All three demo account settings are required and must satisfy signup rules");
            }
        }
        return new AuthSettings(key, origin, Boolean.parseBoolean(secure), email == null ? null : kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email), password, kr.co.fitdining.api.auth.domain.AuthText.strip(nickname), simple, devKey);
    }

    /** Derives a stable development-only signing key without configured credentials. */
    private static byte[] localSigningKey() {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest("fitdining-local-dev-signing-key".getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required for the local signing key", e);
        }
    }

    @Override public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof AuthSettings that)) return false;
        return Arrays.equals(signingKey, that.signingKey)
                && Objects.equals(origin, that.origin)
                && cookieSecure == that.cookieSecure
                && Objects.equals(demoEmail, that.demoEmail)
                && Objects.equals(demoPassword, that.demoPassword)
                && Objects.equals(demoNickname, that.demoNickname)
                && simpleEnabled == that.simpleEnabled
                && Objects.equals(devKey, that.devKey);
    }

    @Override public int hashCode() {
        return 31 * Objects.hash(origin, cookieSecure, demoEmail, demoPassword, demoNickname, simpleEnabled, devKey)
                + Arrays.hashCode(signingKey);
    }

    /** Prevents accidental credential disclosure through record-generated logging. */
    @Override public String toString() { return "AuthSettings[redacted]"; }
}
