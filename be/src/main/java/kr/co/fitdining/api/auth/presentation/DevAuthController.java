package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import kr.co.fitdining.api.auth.application.AuthService;
import kr.co.fitdining.api.auth.application.AuthTransactions;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.AuthSettings;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.*;

/** Development-only passwordless session login, guarded by the server development key. */
@RestController
@ConditionalOnWebApplication
@ConditionalOnBooleanProperty(name = "auth.simple.enabled")
@RequiredArgsConstructor
public class DevAuthController {
    private final AuthSettings settings;
    private final AuthUserRepository users;
    private final AuthTransactions transactions;
    private final kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions;

    /** @param email optional existing account email; absent selects the configured demo account */
    public record DevTokenRequest(@Email @Size(max = 254) String email) {}

    @PostMapping("/api/auth/dev/token")
    public AuthController.TokenResponse token(@RequestHeader(name = "X-Dev-Key", required = false) String key,
            @Valid @RequestBody(required = false) DevTokenRequest body, jakarta.servlet.http.HttpServletRequest request, HttpServletResponse response) {
        if (settings.devKey() != null && (key == null || !MessageDigest.isEqual(
                settings.devKey().getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8))))
            throw new AuthFailure("허용되지 않은 요청입니다.", 403);
        String email = body == null || body.email() == null ? settings.demoEmail() : AuthService.normalizeEmail(body.email());
        var issued = transactions.login(users.findByEmail(email)
                .orElseThrow(() -> new AuthFailure("계정을 찾을 수 없습니다.", 404)));
        sessions.establish(issued.identity(), request, response);
        LoginSuccessAudit.record(() -> transactions.audit(issued.identity().userId(), "LOGIN_SUCCESS"));
        return AuthController.sessionResponse(issued);
    }
}
