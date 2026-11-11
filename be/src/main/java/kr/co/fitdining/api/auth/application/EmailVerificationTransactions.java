package kr.co.fitdining.api.auth.application;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import kr.co.fitdining.api.auth.domain.AuthEmailVerification;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthLoginAttempt;
import kr.co.fitdining.api.auth.domain.EmailVerificationFailure;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
import kr.co.fitdining.api.auth.repository.AuthEmailVerificationRepository;
import kr.co.fitdining.api.auth.repository.AuthLoginAttemptRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이메일 인증의 짧은 트랜잭션. 메일 발송과 해시 계산은 여기서 하지 않는다. */
@Service
@ConditionalOnWebApplication
@RequiredArgsConstructor
public class EmailVerificationTransactions {
    /** 인증번호 유효 시간. */
    public static final Duration CODE_TTL = Duration.ofMinutes(10);
    /** 같은 이메일로 다시 보내기까지 기다리는 시간. */
    public static final Duration RESEND_WAIT = Duration.ofSeconds(60);
    /** 인증 토큰 유효 시간. 1회용이다. */
    public static final Duration TOKEN_TTL = Duration.ofMinutes(30);
    /** 주소별 시도 제한 창. auth.cleanup.attempt-retention과 같다. */
    public static final Duration ADDRESS_WINDOW = Duration.ofMinutes(15);
    /** 주소별 발송 요청 한도(15분). */
    public static final int SEND_ADDRESS_LIMIT = 10;
    /** 주소별 확인 요청 한도(15분). 인증번호마다 5회 제한이 따로 있다. */
    public static final int CONFIRM_ADDRESS_LIMIT = 30;
    /** 이메일별 발송 한도 창. */
    public static final Duration EMAIL_WINDOW = Duration.ofHours(1);
    /** 이메일별 발송 한도(1시간). */
    public static final int SEND_EMAIL_LIMIT = 5;

    private final AuthEmailVerificationRepository verifications;
    private final AuthLoginAttemptRepository attempts;
    private final Clock clock;
    private final AuthPolicy policy;

    /**
     * 주소별 발송 요청 수가 한도 안이면 이번 요청을 기록한다. 메일 한도를 지키려고 간소 모드에서도 적용한다.
     * @param address 요청 주소
     * @return 한도 안이면 true
     */
    @Transactional
    public boolean recordSend(String address) {
        return record(address, "verify_send", SEND_ADDRESS_LIMIT);
    }

    /**
     * 주소별 확인 요청 수가 한도 안이면 이번 요청을 기록한다. 로그인 시도 제한처럼 간소 모드에서는 끈다.
     * @param address 요청 주소
     * @return 한도 안이면 true
     */
    @Transactional
    public boolean recordConfirm(String address) {
        if (!policy.limitAttempts()) return true;
        return record(address, "verify_confirm", CONFIRM_ADDRESS_LIMIT);
    }

    private boolean record(String address, String action, int limit) {
        Instant now = clock.instant();
        attempts.lockAddress(address + ":" + action);
        if (attempts.countByAddressAndActionAndCreatedAtAfter(address, action, now.minus(ADDRESS_WINDOW)) >= limit) return false;
        attempts.save(new AuthLoginAttempt(address, action, now));
        return true;
    }

    /**
     * 이전 인증번호를 무효로 하고 새 인증번호의 해시를 저장한다.
     * @param email 정규화한 이메일
     * @param codeHash 인증번호 해시
     * @return 저장한 발송 기록
     * @throws AuthFailure 재발송 대기 중이거나 이메일별 한도를 넘었을 때 429
     */
    @Transactional
    public Issued issue(String email, String codeHash) {
        Instant now = clock.instant();
        verifications.lockEmail("verify:" + email);
        // 발송 제한은 메일 계정 한도를 지키려고 간소 모드에서도 적용한다(D9)
        var latest = verifications.findTopByEmailOrderByCreatedAtDescIdDesc(email);
        if (latest.isPresent() && latest.get().getCreatedAt().plus(RESEND_WAIT).isAfter(now)) {
            throw EmailVerificationFailure.tooManyRequests(
                    Duration.between(now, latest.get().getCreatedAt().plus(RESEND_WAIT)).toSeconds() + 1);
        }
        if (verifications.countByEmailAndCreatedAtAfter(email, now.minus(EMAIL_WINDOW)) >= SEND_EMAIL_LIMIT) {
            throw EmailVerificationFailure.tooManyRequests(EMAIL_WINDOW.toSeconds());
        }
        verifications.expirePending(email, now);
        Instant expiresAt = now.plus(CODE_TTL);
        var saved = verifications.saveAndFlush(new AuthEmailVerification(email, codeHash, now, expiresAt));
        return new Issued(saved.getId(), expiresAt, now.plus(RESEND_WAIT));
    }

    /** 메일을 보내지 못한 발송 기록을 지워 바로 다시 요청할 수 있게 한다. @param id 발송 기록 */
    @Transactional
    public void cancel(long id) { verifications.deleteById(id); }

    /**
     * 가장 최근 인증번호와 비교한다. 틀린 횟수를 남겨야 하므로 실패도 예외 대신 값으로 돌려준다.
     * @param email 정규화한 이메일
     * @param codeHash 입력한 인증번호의 해시
     * @param tokenHash 성공 때 저장할 인증 토큰 해시
     * @return 토큰 만료 시각 또는 실패
     */
    @Transactional
    public Confirmation confirm(String email, String codeHash, String tokenHash) {
        Instant now = clock.instant();
        var found = verifications.findTopByEmailOrderByCreatedAtDescIdDesc(email);
        if (found.isEmpty()) return Confirmation.failed(EmailVerificationFailure.codeExpired());
        AuthEmailVerification verification = found.get();
        if (verification.getVerifiedAt() != null || !verification.getExpiresAt().isAfter(now))
            return Confirmation.failed(EmailVerificationFailure.codeExpired());
        if (verification.attemptsExhausted()) return Confirmation.failed(EmailVerificationFailure.attemptsExceeded());
        if (!MessageDigest.isEqual(verification.getCodeHash().getBytes(StandardCharsets.US_ASCII),
                codeHash.getBytes(StandardCharsets.US_ASCII))) {
            return Confirmation.failed(verification.recordMismatch()
                    ? EmailVerificationFailure.attemptsExceeded() : EmailVerificationFailure.codeMismatch());
        }
        Instant tokenExpiresAt = now.plus(TOKEN_TTL);
        verification.verify(now, tokenHash, tokenExpiresAt);
        return new Confirmation(tokenExpiresAt, null);
    }

    /**
     * @param id 발송 기록 식별자
     * @param expiresAt 인증번호 만료 시각
     * @param resendAvailableAt 다시 보낼 수 있는 시각
     */
    public record Issued(long id, Instant expiresAt, Instant resendAvailableAt) {}

    /**
     * @param tokenExpiresAt 인증 토큰 만료 시각. 실패하면 null
     * @param failure 실패 이유. 성공하면 null
     */
    public record Confirmation(Instant tokenExpiresAt, AuthFailure failure) {
        static Confirmation failed(AuthFailure failure) { return new Confirmation(null, failure); }
    }
}
