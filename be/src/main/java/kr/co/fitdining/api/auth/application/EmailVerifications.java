package kr.co.fitdining.api.auth.application;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.EmailVerificationFailure;
import kr.co.fitdining.api.auth.domain.SignupConflict;
import kr.co.fitdining.api.auth.infrastructure.AuthSettings;
import kr.co.fitdining.api.auth.ports.VerificationMailer;
import kr.co.fitdining.api.auth.repository.AuthEmailVerificationRepository;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;

/**
 * 가입 전 이메일 소유 확인(D1·D2). 인증번호 요청 → 확인 → 1회용 인증 토큰 발급 순서이며,
 * 가입 API는 이 토큰을 계정 INSERT와 같은 트랜잭션에서 사용 처리한다.
 * 메일 발송과 해시 계산은 트랜잭션 밖에서 한다.
 */
@Slf4j
@Service
@ConditionalOnWebApplication
public class EmailVerifications {
    /** 인증 토큰 원문의 최대 길이. 32바이트 base64url은 43자다. */
    static final int MAX_TOKEN_LENGTH = 128;
    private final EmailVerificationTransactions transactions;
    private final AuthUserRepository users;
    private final AuthEmailVerificationRepository verifications;
    private final VerificationMailer mailer;
    private final Clock clock;
    private final byte[] codeKey;
    private final SecureRandom random = new SecureRandom();

    public EmailVerifications(EmailVerificationTransactions transactions, AuthUserRepository users,
            AuthEmailVerificationRepository verifications, VerificationMailer mailer, Clock clock, AuthSettings settings) {
        this.transactions = transactions;
        this.users = users;
        this.verifications = verifications;
        this.mailer = mailer;
        this.clock = clock;
        this.codeKey = settings.signingKey();
    }

    /**
     * 인증번호를 만들어 메일로 보낸다. 같은 이메일의 이전 인증번호는 무효가 된다.
     * @param email 형식 검사를 마친 이메일
     * @param address 요청 주소
     * @return 인증번호 만료 시각과 다시 보낼 수 있는 시각
     * @throws AuthFailure 이미 가입한 이메일 409, 시도 제한 429, 발송 실패 503
     */
    public Requested request(String email, String address) {
        String normalized = AuthService.normalizeEmail(email);
        if (!transactions.recordSend(address))
            throw new AuthFailure("잠시 후 다시 시도해주세요.", 429);
        if (users.findByEmail(normalized).isPresent()) throw new SignupConflict("email");
        String code = "%06d".formatted(random.nextInt(1_000_000));
        var issued = transactions.issue(normalized, codeHash(normalized, code));
        try {
            mailer.sendVerificationCode(normalized, code);
        } catch (RuntimeException failure) {
            // 받는 사람 주소가 예외 메시지에 들어갈 수 있어 예외 종류만 남긴다.
            log.error("Verification mail delivery failed: verificationId={}, cause={}", issued.id(), causes(failure));
            transactions.cancel(issued.id());
            throw EmailVerificationFailure.mailUnavailable();
        }
        return new Requested(issued.expiresAt(), issued.resendAvailableAt());
    }

    /**
     * 인증번호를 확인하고 1회용 인증 토큰을 발급한다.
     * @param email 형식 검사를 마친 이메일
     * @param code 6자리 인증번호
     * @param address 요청 주소
     * @return 인증 토큰 원문과 만료 시각. 원문은 저장하지 않는다
     * @throws AuthFailure 번호 불일치 400, 만료 400, 시도 초과 429
     */
    public Confirmed confirm(String email, String code, String address) {
        String normalized = AuthService.normalizeEmail(email);
        if (!transactions.recordConfirm(address))
            throw new AuthFailure("잠시 후 다시 시도해주세요.", 429);
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        var result = transactions.confirm(normalized, codeHash(normalized, code), tokenHash(token));
        if (result.failure() != null) throw result.failure();
        return new Confirmed(token, result.tokenExpiresAt());
    }

    /**
     * 가입 전에 인증 토큰을 미리 확인해 BCrypt 비용을 아낀다. 실제 사용 처리는 가입 트랜잭션이 한다.
     * @param email 정규화한 가입 이메일
     * @param token 인증 토큰 원문
     * @return 사용 처리에 쓸 토큰 해시
     * @throws AuthFailure 토큰이 없거나 만료·사용됨·다른 이메일이면 400 verification-required
     */
    public String requireToken(String email, String token) {
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) throw EmailVerificationFailure.required();
        String hash = tokenHash(token);
        Instant now = clock.instant();
        boolean usable = verifications.findByTokenHash(hash)
                .filter(found -> found.getEmail().equals(email) && found.getConsumedAt() == null
                        && found.getTokenExpiresAt() != null && found.getTokenExpiresAt().isAfter(now))
                .isPresent();
        if (!usable) throw EmailVerificationFailure.required();
        return hash;
    }

    /** 인증번호는 경우의 수가 적어 서버 비밀값으로 HMAC한다. */
    String codeHash(String email, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(codeKey, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((email + "\n" + code).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 is required", e);
        }
    }

    /** 인증 토큰은 256비트 난수라 SHA-256만으로 충분하다. */
    public static String tokenHash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is required", e);
        }
    }

    private static String causes(Throwable failure) {
        StringBuilder names = new StringBuilder();
        for (Throwable cause = failure; cause != null && names.length() < 300; cause = cause.getCause()) {
            if (!names.isEmpty()) names.append(" <- ");
            names.append(cause.getClass().getName());
        }
        return names.toString();
    }

    /**
     * @param expiresAt 인증번호 만료 시각
     * @param resendAvailableAt 다시 받기를 누를 수 있는 시각
     */
    public record Requested(Instant expiresAt, Instant resendAvailableAt) {}

    /**
     * @param verificationToken 가입 요청에 넣을 1회용 토큰 원문
     * @param expiresAt 토큰 만료 시각
     */
    public record Confirmed(String verificationToken, Instant expiresAt) {}
}
