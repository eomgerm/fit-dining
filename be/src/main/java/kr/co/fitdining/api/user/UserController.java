package kr.co.fitdining.api.user;

import java.time.Instant;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController @ConditionalOnWebApplication @RequiredArgsConstructor
@RequestMapping("/api/v1/users/{userId}")
public class UserController {
    private final UserPreferencesRepository preferences;
    private final kr.co.fitdining.api.auth.repository.AuthUserRepository users;
    private final UserService service;
    @org.springframework.beans.factory.annotation.Value("${auth.cookie-secure}") private boolean secure;
    @DeleteMapping
    public org.springframework.http.ResponseEntity<Void> withdraw(@PathVariable String userId,
            @RequestAttribute("auth.identity") Identity identity, jakarta.servlet.http.HttpServletResponse response) {
        requireOwner(userId, identity);
        service.withdraw(userId);
        kr.co.fitdining.api.auth.presentation.AuthController.clearCookie(response, secure);
        return org.springframework.http.ResponseEntity.noContent().build();
    }
    @GetMapping("/preferences")
    public PreferencesResponse preferences(@PathVariable String userId,
            @RequestAttribute("auth.identity") Identity identity) {
        requireOwner(userId, identity);
        if (!users.existsByIdAndDeletedAtIsNull(userId))
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다.");
        UserPreferences value = preferences.findById(userId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "취향 정보가 없습니다."));
        return new PreferencesResponse(value.getMood(), value.getPriorities(), value.getPurposes(), value.getTastes(), value.getUpdatedAt());
    }
    static void requireOwner(String userId, Identity identity) {
        if (!userId.equals(identity.userId())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "접근 권한이 없습니다.");
    }
    /** @param mood optional atmosphere @param priorities criteria @param purposes purposes @param tastes tastes @param updatedAt last change */
    public record PreferencesResponse(String mood, String[] priorities, String[] purposes, List<Preferences.TasteChip> tastes, Instant updatedAt) {}
}
