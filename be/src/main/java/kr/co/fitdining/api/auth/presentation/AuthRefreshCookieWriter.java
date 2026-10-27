package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import java.time.Duration;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Writes the shared refresh cookie policy for email and social authentication responses. */
@Component
@ConditionalOnWebApplication
public class AuthRefreshCookieWriter {
    private final boolean secure;
    private final Clock clock;
    public AuthRefreshCookieWriter(@Value("${auth.cookie-secure}") boolean secure, Clock clock) {
        this.secure = secure;
        this.clock = clock;
    }

    public AuthController.TokenResponse issued(Issued issued, HttpServletResponse response) {
        Identity identity = issued.identity();
        long remaining = Math.max(0, identity.sessionExpiresAt() - clock.instant().getEpochSecond());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(issued.refreshToken(), secure, remaining).toString());
        return new AuthController.TokenResponse(identity.userId(), issued.accessToken(), identity.nickname(), identity.sessionId(),
            identity.accessExpiresAt(), identity.sessionExpiresAt());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", secure, 0).toString());
    }

    static ResponseCookie cookie(String value, boolean secure, long age) {
        return ResponseCookie.from(AuthController.COOKIE, value).httpOnly(true).secure(secure).sameSite("Strict")
            .path("/api/auth").maxAge(Duration.ofSeconds(age)).build();
    }
}
