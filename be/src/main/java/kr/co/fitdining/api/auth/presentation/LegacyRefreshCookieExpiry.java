package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/** Expires the legacy refresh cookie on logout; never issues authentication cookies. */
@Component
@ConditionalOnWebApplication
public class LegacyRefreshCookieExpiry {
    private final boolean secure;
    public LegacyRefreshCookieExpiry(@Value("${auth.cookie-secure}") boolean secure) {
        this.secure = secure;
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", secure, 0).toString());
    }

    static ResponseCookie cookie(String value, boolean secure, long age) {
        return ResponseCookie.from(AuthController.COOKIE, value).httpOnly(true).secure(secure).sameSite("Strict")
            .path("/api/auth").maxAge(Duration.ofSeconds(age)).build();
    }
}
