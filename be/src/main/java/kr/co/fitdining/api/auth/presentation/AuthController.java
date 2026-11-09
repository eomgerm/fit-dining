package kr.co.fitdining.api.auth.presentation;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.CookieValue;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;

@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/auth")
public class AuthController {
    public static final String COOKIE = "fitdining_rt";
    private final AuthUseCases auth;
    private final AuthRefreshCookieWriter cookies;
    private final kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions;

    public AuthController(AuthUseCases auth, AuthRefreshCookieWriter cookies, kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions) {
        this.sessions = sessions;
        this.auth = auth;
        this.cookies = cookies;
    }
    /**
     * @param email required email, at most 254 characters
     * @param password required password; UTF-8 byte limit is validated by the service
     */
    public record LoginRequest(@NotBlank @Size(max = 254) String email, @NotEmpty String password) {
        public LoginRequest {
            email = email == null ? null : kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email);
        }
    }
    /**
     * @param userId account identifier equal to JWT sub
     * @param accessToken signed AT
     * @param nickname current public name
     * @param sessionId refresh family identifier
     * @param accessExpiresAt AT expiry in epoch seconds
     * @param sessionExpiresAt absolute family expiry in epoch seconds
     */
    public record TokenResponse(String userId, String accessToken, String nickname, String sessionId, long accessExpiresAt, long sessionExpiresAt) {}
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        var result = auth.login(body.email(), body.password(), request.getRemoteAddr());
        var tokenResponse = issued(result, response);
        sessions.establish(result.identity(), request, response);
        return tokenResponse;
    }
    @PostMapping("/signup")
    public ResponseEntity<TokenResponse> signup(@Valid @RequestBody SignupRequest body,
            HttpServletRequest request, HttpServletResponse response) {
        Issued result = body.preferences() == null
                ? auth.signup(body.email(), body.password(), body.nickname(), body.verificationToken(), request.getRemoteAddr())
                : auth.signup(body.email(), body.password(), body.nickname(), body.verificationToken(), request.getRemoteAddr(),
                        body.preferences());
        var tokenResponse = issued(result, response);
        sessions.establish(result.identity(), request, response);
        return ResponseEntity.status(201).body(tokenResponse);
    }
    @PostMapping("/refresh")
    public TokenResponse refresh(@CookieValue(name = COOKIE, required = false) String token, HttpServletResponse response) {
        return issued(auth.refresh(token), response);
    }
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = COOKIE, required = false) String token, HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        org.springframework.security.core.context.SecurityContextHolder.clearContext();
        auth.logout(token);
        cookies.clear(response);
        return ResponseEntity.noContent().build();
    }
    public record MeResponse(String userId, String nickname, String email, long sessionExpiresAt) {}
    @GetMapping("/csrf")
    public ResponseEntity<Void> csrf() { return ResponseEntity.noContent().build(); }
    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal Identity identity) {
        var profile = auth.me(identity.userId());
        return new MeResponse(identity.userId(), profile.nickname(), profile.email(), identity.sessionExpiresAt());
    }
    @GetMapping("/protected")
    public Map<String, String> protectedResource(@AuthenticationPrincipal Identity identity) {
        return Map.of("message", "인증에 성공했습니다.", "userId", identity.userId());
    }
    private TokenResponse issued(Issued issued, HttpServletResponse response) {
        return cookies.issued(issued, response);
    }

    public static void clearCookie(HttpServletResponse response, boolean secure) {
        response.addHeader(HttpHeaders.SET_COOKIE, AuthRefreshCookieWriter.cookie("", secure, 0).toString());
    }
}
