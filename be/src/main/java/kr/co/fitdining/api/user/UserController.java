package kr.co.fitdining.api.user;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

import java.time.Instant;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;

@RestController @ConditionalOnWebApplication @RequiredArgsConstructor
@RequestMapping("/api/v1/users/{userId}")
public class UserController {
    private final UserService service;
    @GetMapping
    public UserService.Profile profile(@PathVariable String userId,
            @AuthenticationPrincipal Identity identity) {
        return service.profile(userId, identity);
    }
    public record ContactEmailRequest(
            @kr.co.fitdining.api.auth.presentation.SignupValue(value = "email") String email, String verificationToken) {
        public ContactEmailRequest {
            email = email == null ? null : kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email);
        }
    }
    public record MarketingConsentRequest(@jakarta.validation.constraints.NotNull Boolean agreed) {}

    @PutMapping("/contact-email")
    public ResponseEntity<Void> contactEmail(@PathVariable String userId, @AuthenticationPrincipal Identity identity,
            @jakarta.validation.Valid @RequestBody ContactEmailRequest body) {
        service.contactEmail(userId, identity, body.email(), body.verificationToken());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/marketing-consent")
    public ResponseEntity<Void> marketingConsent(@PathVariable String userId, @AuthenticationPrincipal Identity identity,
            @jakarta.validation.Valid @RequestBody MarketingConsentRequest body) {
        service.marketingConsent(userId, identity, body.agreed());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> withdraw(@PathVariable String userId,
            @AuthenticationPrincipal Identity identity, jakarta.servlet.http.HttpServletRequest request) {
        service.withdraw(userId, identity);
        var session = request.getSession(false);
        if (session != null) session.invalidate();
        org.springframework.security.core.context.SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }
    @GetMapping("/preferences")
    public PreferencesResponse preferences(@PathVariable String userId,
            @AuthenticationPrincipal Identity identity) {
        UserPreferences value = service.preferences(userId, identity);
        return new PreferencesResponse(value.getMood(), value.getPriorities(), value.getPurposes(),
                value.getTastes().stream().map(StoredTasteChip::chip).toList(), value.getUpdatedAt());
    }
    /** @param mood optional atmosphere @param priorities criteria @param purposes purposes @param tastes tastes @param updatedAt last change */
    public record PreferencesResponse(String mood, String[] priorities, String[] purposes, List<Preferences.TasteChip> tastes, Instant updatedAt) {}
}
