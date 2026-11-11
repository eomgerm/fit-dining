package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.Instant;
import kr.co.fitdining.api.auth.application.AuthService;
import kr.co.fitdining.api.auth.application.EmailVerifications;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 가입 전 이메일 인증번호 요청과 확인. 공개 API이며 Origin 검사를 받는다. */
@RestController
@ConditionalOnWebApplication
@RequiredArgsConstructor
@RequestMapping("/api/auth/email-verifications")
public class EmailVerificationController {
    private final EmailVerifications verifications;

    /** @param email 인증할 이메일. 검사 전에 정규화한다 */
    public record EmailVerificationRequest(
            @SignupValue(value = "email", message = "이메일 형식을 확인해 주세요.") String email,
            @Pattern(regexp = "signup|contact", message = "인증 목적은 signup 또는 contact여야 합니다.") String purpose) {
        public EmailVerificationRequest(String email) { this(email, "signup"); }
        public EmailVerificationRequest {
            email = email == null ? null : AuthService.normalizeEmail(email);
            purpose = purpose == null ? "signup" : purpose;
        }
    }

    /**
     * @param email 인증번호를 받은 이메일. 검사 전에 정규화한다
     * @param code 6자리 숫자 인증번호
     */
    public record EmailVerificationConfirmRequest(
            @SignupValue(value = "email", message = "이메일 형식을 확인해 주세요.") String email,
            @NotNull(message = "인증번호 6자리를 입력해 주세요.")
            @Pattern(regexp = "[0-9]{6}", message = "인증번호 6자리를 입력해 주세요.") String code) {
        public EmailVerificationConfirmRequest {
            email = email == null ? null : AuthService.normalizeEmail(email);
        }
    }

    /**
     * @param expiresAt 인증번호 만료 시각
     * @param resendAvailableAt 다시 받기를 누를 수 있는 시각
     */
    public record EmailVerificationResponse(Instant expiresAt, Instant resendAvailableAt) {}

    /**
     * @param verificationToken 가입 요청에 넣을 1회용 토큰
     * @param expiresAt 토큰 만료 시각
     */
    public record EmailVerificationConfirmResponse(String verificationToken, Instant expiresAt) {}

    @PostMapping
    public ResponseEntity<EmailVerificationResponse> request(@Valid @RequestBody EmailVerificationRequest body,
            HttpServletRequest request) {
        var requested = verifications.request(body.email(), request.getRemoteAddr(), body.purpose());
        return ResponseEntity.accepted().body(new EmailVerificationResponse(requested.expiresAt(), requested.resendAvailableAt()));
    }

    @PostMapping("/confirm")
    public EmailVerificationConfirmResponse confirm(@Valid @RequestBody EmailVerificationConfirmRequest body,
            HttpServletRequest request) {
        var confirmed = verifications.confirm(body.email(), body.code(), request.getRemoteAddr());
        return new EmailVerificationConfirmResponse(confirmed.verificationToken(), confirmed.expiresAt());
    }
}
