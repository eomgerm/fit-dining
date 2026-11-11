package kr.co.fitdining.api.auth.presentation;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

/** Required agreements and optional onboarding answers; legacy nickname input is ignored. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record SocialSignupRequest(
    @NotNull(message = "필수 약관에 모두 동의해 주세요.") @Valid SignupRequest.Agreements agreements,
    @Valid kr.co.fitdining.api.user.Preferences preferences,
    @SignupValue(value = "email", optional = true, message = "이메일 형식을 확인해 주세요.") String contactEmail,
    String verificationToken) {
    public SocialSignupRequest(SignupRequest.Agreements agreements, kr.co.fitdining.api.user.Preferences preferences) {
        this(agreements, preferences, null, null);
    }
    public SocialSignupRequest {
        contactEmail = contactEmail == null ? null : kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(contactEmail);
    }
}
