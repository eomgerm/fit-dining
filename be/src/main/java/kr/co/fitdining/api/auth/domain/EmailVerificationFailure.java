package kr.co.fitdining.api.auth.domain;

import java.net.URI;

/** 이메일 인증 오류의 ProblemDetail type. FE는 type으로 문구를 고른다. */
public final class EmailVerificationFailure {
    public static final URI CODE_MISMATCH = URI.create("urn:fitdining:auth:verification-code-mismatch");
    public static final URI EXPIRED = URI.create("urn:fitdining:auth:verification-expired");
    public static final URI ATTEMPTS_EXCEEDED = URI.create("urn:fitdining:auth:verification-attempts-exceeded");
    public static final URI REQUIRED = URI.create("urn:fitdining:auth:verification-required");
    public static final URI MAIL_UNAVAILABLE = URI.create("urn:fitdining:auth:mail-unavailable");

    private EmailVerificationFailure() {}

    /** @return 인증번호가 맞지 않을 때의 400 */
    public static AuthFailure codeMismatch() { return new AuthFailure("Verification code mismatch", 400, CODE_MISMATCH); }
    /** @return 인증번호가 없거나 만료됐을 때의 400 */
    public static AuthFailure expired() { return new AuthFailure("Verification code expired", 400, EXPIRED); }
    /** @return 확인 시도를 모두 써서 다시 받아야 할 때의 429 */
    public static AuthFailure attemptsExceeded() {
        return new AuthFailure("Verification attempts exceeded", 429, ATTEMPTS_EXCEEDED);
    }
    /** @return 가입 요청의 인증 토큰이 없거나 쓸 수 없을 때의 400 */
    public static AuthFailure required() { return new AuthFailure("Email verification required", 400, REQUIRED); }
    /** @return 메일 발송 실패 503 */
    public static AuthFailure mailUnavailable() { return new AuthFailure("Verification mail unavailable", 503, MAIL_UNAVAILABLE); }
    /** @param seconds 다시 요청할 수 있을 때까지 남은 초 @return 발송 제한 429 */
    public static AuthFailure tooManyRequests(long seconds) {
        return new AuthFailure("Verification request limited", 429, null, seconds);
    }
}
