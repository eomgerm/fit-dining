package kr.co.fitdining.api.auth.presentation;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Issued;

@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/auth")
public class AuthController {
    public static final String COOKIE = "fitdining_rt";
    private final AuthUseCases auth;
    private final LegacyRefreshCookieExpiry cookies;
    private final kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions;

    public AuthController(AuthUseCases auth, LegacyRefreshCookieExpiry cookies, kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions) {
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
    public record TokenResponse(String userId, String nickname, long sessionExpiresAt) {}
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        var result = auth.login(body.email(), body.password(), request.getRemoteAddr());
        sessions.establish(result.identity(), request, response);
        LoginSuccessAudit.record(() -> auth.sessionEstablished(result.identity().userId()));
        return sessionResponse(result);
    }
    @PostMapping("/signup")
    public ResponseEntity<TokenResponse> signup(@Valid @RequestBody SignupRequest body,
            HttpServletRequest request, HttpServletResponse response) {
        Issued result = body.preferences() == null
                ? auth.signup(body.email(), body.password(), body.nickname(), body.verificationToken(), request.getRemoteAddr())
                : auth.signup(body.email(), body.password(), body.nickname(), body.verificationToken(), request.getRemoteAddr(),
                        body.preferences());
        sessions.establish(result.identity(), request, response);
        LoginSuccessAudit.record(() -> auth.sessionEstablished(result.identity().userId()));
        return ResponseEntity.status(201).body(sessionResponse(result));
    }
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal Identity identity, HttpServletRequest request, HttpServletResponse response) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        org.springframework.security.core.context.SecurityContextHolder.clearContext();
        if (identity != null) auth.logout(identity.userId());
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
    public static TokenResponse sessionResponse(Issued issued) {
        var identity = issued.identity();
        return new TokenResponse(identity.userId(), identity.nickname(), identity.sessionExpiresAt());
    }
}
