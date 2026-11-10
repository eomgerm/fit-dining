package kr.co.fitdining.api.auth.application;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import kr.co.fitdining.api.auth.repository.AuthEmailVerificationRepository;
import kr.co.fitdining.api.auth.repository.AuthLoginAttemptRepository;
import kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository;
import kr.co.fitdining.api.onboarding.TasteInputLogs;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Bounded, idempotent expiry deletion; evidence has an independent retention period. */
@Service
@ConditionalOnWebApplication
public class AuthCleanup {
    private final AuthSecurityEventRepository events;
    private final AuthLoginAttemptRepository attempts;
    private final TasteInputLogs tasteInputs;
    private final AuthEmailVerificationRepository verifications;
    private final Clock clock;
    private final Duration eventRetention;
    private final Duration attemptRetention;
    private final Duration tasteInputRetention;
    private final Duration verificationRetention;
    private final int batchSize;

    public AuthCleanup(AuthSecurityEventRepository events,
            AuthLoginAttemptRepository attempts, TasteInputLogs tasteInputs,
            AuthEmailVerificationRepository verifications, Clock clock,
            @Value("${auth.cleanup.event-retention:P90D}") Duration eventRetention,
            @Value("${auth.cleanup.attempt-retention:PT15M}") Duration attemptRetention,
            @Value("${auth.cleanup.taste-input-retention:P90D}") Duration tasteInputRetention,
            @Value("${auth.cleanup.verification-retention:P1D}") Duration verificationRetention,
            @Value("${auth.cleanup.batch-size:1000}") int batchSize) {
        if (batchSize < 1 || eventRetention.isNegative() || attemptRetention.isNegative()
                || tasteInputRetention.isNegative()) {
            throw new IllegalArgumentException("Cleanup policy must be nonnegative with a positive batch size");
        }
        // 이메일별 1시간 발송 제한과 30분 인증 토큰을 세려면 그보다 오래 남겨야 한다.
        if (verificationRetention.compareTo(EmailVerificationTransactions.EMAIL_WINDOW) < 0) {
            throw new IllegalArgumentException("Verification retention must cover the per-email send window");
        }
        this.events = events;
        this.attempts = attempts;
        this.tasteInputs = tasteInputs;
        this.verifications = verifications;
        this.clock = clock;
        this.eventRetention = eventRetention;
        this.attemptRetention = attemptRetention;
        this.tasteInputRetention = tasteInputRetention;
        this.verificationRetention = verificationRetention;
        this.batchSize = batchSize;
    }

    /** Each table deletes at most batchSize rows; no dependency on total retained history. */
    @Scheduled(fixedDelayString = "${auth.cleanup.interval:PT10M}", initialDelayString = "${auth.cleanup.interval:PT10M}")
    @Transactional
    public void clean() {
        // No ShedLock: concurrent Blue/Green deletes are idempotent and every run is bounded.
        Instant now = clock.instant();
        events.deleteExpiredBatch(now.minus(eventRetention), batchSize);
        attempts.deleteExpiredBatch(now.minus(attemptRetention), batchSize);
        tasteInputs.deleteExpiredBatch(now.minus(tasteInputRetention), batchSize);
        verifications.deleteExpiredBatch(now.minus(verificationRetention), batchSize);
    }
}
