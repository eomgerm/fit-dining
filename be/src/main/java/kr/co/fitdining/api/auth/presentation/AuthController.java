package kr.co.fitdining.api.auth.presentation;

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
import org.springframework.web.bind.annotation.RequestAttribute;
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

    public AuthController(AuthUseCases auth, AuthRefreshCookieWriter cookies) {
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
        return issued(auth.login(body.email(), body.password(), request.getRemoteAddr()), response);
    }
    @PostMapping("/signup")
    public ResponseEntity<TokenResponse> signup(@Valid @RequestBody SignupRequest body,
            HttpServletRequest request, HttpServletResponse response) {
        Issued result = body.preferences() == null
                ? auth.signup(body.email(), body.password(), body.nickname(), request.getRemoteAddr())
                : auth.signup(body.email(), body.password(), body.nickname(), request.getRemoteAddr(), body.preferences());
        return ResponseEntity.status(201).body(issued(result, response));
    }
    @PostMapping("/refresh")
    public TokenResponse refresh(@CookieValue(name = COOKIE, required = false) String token, HttpServletResponse response) {
        return issued(auth.refresh(token), response);
    }
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = COOKIE, required = false) String token, HttpServletResponse response) {
        auth.logout(token);
        cookies.clear(response);
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/me")
    public AuthUseCases.Profile me(@RequestAttribute("auth.identity") Identity identity) { return auth.me(identity.userId()); }
    @GetMapping("/protected")
    public Map<String, String> protectedResource(@RequestAttribute("auth.identity") Identity identity) {
        return Map.of("message", "인증에 성공했습니다.", "userId", identity.userId());
    }
    private TokenResponse issued(Issued issued, HttpServletResponse response) {
        return cookies.issued(issued, response);
    }

    public static void clearCookie(HttpServletResponse response, boolean secure) {
        response.addHeader(HttpHeaders.SET_COOKIE, AuthRefreshCookieWriter.cookie("", secure, 0).toString());
    }
}
