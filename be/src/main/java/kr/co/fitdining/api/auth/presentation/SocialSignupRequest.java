package kr.co.fitdining.api.auth.presentation;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import kr.co.fitdining.api.auth.domain.AuthText;

/** @param nickname public name @param agreements all required agreements @param preferences optional onboarding answers; absent means no preference row */
public record SocialSignupRequest(
    @SignupValue(value = "nickname", message = "리뷰에 보이는 이름이에요. 2~15자") String nickname,
    @NotNull(message = "필수 약관에 모두 동의해 주세요.") @Valid SignupRequest.Agreements agreements, @Valid kr.co.fitdining.api.user.Preferences preferences) {
    public SocialSignupRequest {
        nickname = AuthText.strip(nickname);
    }
}
