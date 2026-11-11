package kr.co.fitdining.api.auth.presentation;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;
import kr.co.fitdining.api.auth.application.AuthService;

/**
 * @param email account email, normalized before validation
 * @param password raw password, never persisted
 * @param nickname trimmed public name
 * @param preferences optional onboarding answers; absent means no preference row
 * @param agreements all required agreements
 * @param verificationToken one-time token from email verification; absence is rejected by the service
 *        with the verification-required type so the client can return to the verification step
 */
public record SignupRequest(
        @SignupValue(value = "email", message = "이메일 형식을 확인해 주세요.") String email,
        @SignupValue(value = "password", message = "영문과 숫자를 섞어 8자 이상") String password,
        @SignupValue(value = "nickname", message = "리뷰에 보이는 이름이에요. 2~15자") String nickname,
        @NotNull(message = "필수 약관에 모두 동의해 주세요.") @Valid Agreements agreements, @Valid kr.co.fitdining.api.user.Preferences preferences,
        String verificationToken) {
    public SignupRequest(String email, String password, String nickname, Agreements agreements) {
        this(email, password, nickname, agreements, null, null);
    }
    public SignupRequest {
        email = email == null ? null : AuthService.normalizeEmail(email);
        nickname = kr.co.fitdining.api.auth.domain.AuthText.strip(nickname);
    }
    /** @param ageOver14 age confirmation @param terms service terms @param privacy privacy collection */
    public record Agreements(
            @NotNull(message = "만 14세 이상 확인에 동의해 주세요.")
            @AssertTrue(message = "만 14세 이상 확인에 동의해 주세요.") Boolean ageOver14,
            @NotNull(message = "서비스 이용약관에 동의해 주세요.")
            @AssertTrue(message = "서비스 이용약관에 동의해 주세요.") Boolean terms,
            @NotNull(message = "개인정보 수집·이용에 동의해 주세요.")
            @AssertTrue(message = "개인정보 수집·이용에 동의해 주세요.") Boolean privacy, Boolean marketing) {
        public Agreements(Boolean ageOver14, Boolean terms, Boolean privacy) {
            this(ageOver14, terms, privacy, false);
        }
    }
}
