package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.*;
import kr.co.fitdining.api.auth.infrastructure.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Stateless OAuth browser flow.
 * The start and callback handlers deliberately catch exceptions as an exception to the controller convention:
 * OAuth browser navigation must always return a safe 302, including provider and storage failures,
 * instead of exposing a JSON error page. Only exception class names are logged to avoid disclosing credentials.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@Slf4j
public class SocialAuthController {
    private final SocialProviders providers;
    private final SocialProviderClient client;
    private final SocialTokens tokens;
    private final AuthSettings settings;
    private final SocialAccounts accounts;
    private final AuthTransactions transactions;
    private final SessionLogin sessions;
    private final EmailVerifications verifications;
    private static final SecureRandom RANDOM = new SecureRandom();

    @GetMapping("/oauth/{provider}")
    public ResponseEntity<Void> start(@PathVariable String provider, @RequestParam(defaultValue = "login") String from, HttpServletResponse response) {
        from = "signup".equals(from) ? "signup" : "login";
        try {
            var definition = providers.get(provider);
            String state = random(), verifier = definition.pkce() ? random() : "";
            String signed = tokens.encode("oauth_state", provider, state, verifier, from);
            response.addHeader(HttpHeaders.SET_COOKIE, cookie("fitdining_oauth", signed, false, 600).toString());
            var uri = UriComponentsBuilder.fromUriString(definition.authorization()).queryParam("response_type", "code")
                .queryParam("client_id", definition.clientId()).queryParam("redirect_uri", callback(provider)).queryParam("state", state);
            if (definition.scope() != null) uri.queryParam("scope", definition.scope());
            if (definition.pkce()) {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
                String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
                uri.queryParam("code_challenge_method", "S256").queryParam("code_challenge", challenge);
            }
            return redirect(uri.build().encode().toUriString());
        } catch (Exception failure) {
            log.warn("Social authorization start failed: reason={}", failure.getClass().getSimpleName());
            return failed(from);
        }
    }

    @GetMapping("/oauth/{provider}/callback")
    public ResponseEntity<Void> callback(@PathVariable String provider,
        @CookieValue(name = "fitdining_oauth", required = false) String cookie,
        @RequestParam(required = false) String state, @RequestParam(required = false) String code,
        @RequestParam(required = false) String error, HttpServletRequest request, HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("fitdining_oauth", "", false, 0).toString());
        String from = "login";
        boolean failureAuditAllowed = false;
        try {
            String[] payload = tokens.decode(cookie, "oauth_state", 4);
            from = "signup".equals(payload[3]) ? "signup" : "login";
            if (!transactions.recordAttempt(request.getRemoteAddr(), "login")) throw new AuthFailure("Limited", 429);
            failureAuditAllowed = true;
            if (!provider.equals(payload[0]) || state == null
                || !MessageDigest.isEqual(payload[1].getBytes(StandardCharsets.UTF_8),
                        state.getBytes(StandardCharsets.UTF_8))
                || error != null || code == null || code.isBlank()) {
                throw new AuthFailure("Invalid callback");
            }

            var profile = client.exchange(providers.get(provider), code, state, payload[2], callback(provider));
            String subject = profile.subject();
            var issued = accounts.existing(provider, subject);
            if (issued != null) {
                sessions.establish(issued.identity(), request, response);
                LoginSuccessAudit.record(() -> transactions.audit(issued.identity().userId(), "LOGIN_SUCCESS"));
                return redirect("/");
            }

            response.addHeader(HttpHeaders.SET_COOKIE, cookie("fitdining_social", tokens.encode("social_signup", provider, subject, profile.email() == null ? "" : profile.email()), true, 600).toString());
            return redirect("/signup/social");
        } catch (Exception failure) {
            try { if (failureAuditAllowed) transactions.audit(null, "LOGIN_FAILURE"); }
            catch (RuntimeException auditFailure) {
                log.warn("Social login audit failed: reason={}", auditFailure.getClass().getSimpleName());
            }
            log.warn("Social callback failed: reason={}", failure.getClass().getSimpleName());
            return failed(from);
        }
    }

    public record SignupInfo(String provider,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.ALWAYS) String email) {}

    @GetMapping("/social/signup")
    public SignupInfo signupInfo(@CookieValue(name = "fitdining_social", required = false) String cookie) {
        String[] payload = tokens.decode(cookie, "social_signup", 3);
        return new SignupInfo(payload[0], payload[2].isEmpty() ? null : payload[2]);
    }

    @PostMapping("/social/signup")
    public ResponseEntity<AuthController.TokenResponse> signup(@Valid @RequestBody SocialSignupRequest body,
        @CookieValue(name = "fitdining_social", required = false) String cookie, HttpServletRequest request, HttpServletResponse response) {
        String[] identity = tokens.decode(cookie, "social_signup", 3);
        if (!transactions.recordAttempt(request.getRemoteAddr(), "signup")) throw new AuthFailure("Limited", 429);
        String email = body.contactEmail();
        String hash = null;
        if (email == null || email.equals(identity[2])) email = identity[2];
        else hash = verifications.requireToken(email, body.verificationToken());
        if (!SignupValue.Validator.valid("email", email)) throw EmailVerificationFailure.required();
        var issued = accounts.signup(identity[0], identity[1], body.preferences(), email, hash,
                Boolean.TRUE.equals(body.agreements().marketing()));
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("fitdining_social", "", true, 0).toString());
        sessions.establish(issued.identity(), request, response);
        LoginSuccessAudit.record(() -> transactions.audit(issued.identity().userId(), "LOGIN_SUCCESS"));
        return ResponseEntity.status(201).body(AuthController.sessionResponse(issued));
    }

    private String callback(String provider) {
        return settings.origin() + "/api/auth/oauth/" + provider + "/callback";
    }

    private ResponseCookie cookie(String name, String value, boolean social, long age) {
        return ResponseCookie.from(name, value).httpOnly(true).secure(settings.cookieSecure()).sameSite(social ? "Strict" : "Lax")
            .path(social ? "/api/auth/social" : "/api/auth/oauth").maxAge(age).build();
    }

    private static String random() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static ResponseEntity<Void> failed(String from) {
        return redirect("/" + from + "?error=social");
    }

    private static ResponseEntity<Void> redirect(String location) {
        return ResponseEntity.status(302).header(HttpHeaders.LOCATION, location).build();
    }
}
