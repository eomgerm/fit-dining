package kr.co.fitdining.api.auth.infrastructure;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Public account lifecycle hook; Redis changes happen only after the database commits. */
@Component
@lombok.extern.slf4j.Slf4j
@ConditionalOnWebApplication
public class AccountSessions {
    private final FindByIndexNameSessionRepository<?> sessions;
    private final kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository events;
    private final java.time.Clock clock;
    public AccountSessions(FindByIndexNameSessionRepository<?> sessions,
            kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository events, java.time.Clock clock) {
        this.sessions = sessions; this.events = events; this.clock = clock;
    }
    public void invalidateAfterCommit(String userId) {
        if (!TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Account session invalidation requires a transaction");
        events.save(kr.co.fitdining.api.auth.domain.AuthSecurityEvent.login(userId, clock.instant(), "SESSIONS_REVOKED"));
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                java.util.Set<String> sessionIds;
                try {
                    sessionIds = sessions.findByPrincipalName(userId).keySet();
                } catch (org.springframework.dao.DataAccessException failure) {
                    // Exception messages can contain Redis keys (including session IDs).
                    log.warn("Session revocation lookup failed after account withdrawal: userId={}, failedCount={}", userId, 1);
                    return;
                }
                int failedCount = 0;
                for (String sessionId : sessionIds) {
                    try {
                        sessions.deleteById(sessionId);
                    } catch (org.springframework.dao.DataAccessException failure) {
                        failedCount++;
                    }
                }
                if (failedCount > 0) {
                    log.warn("Session revocation failed after account withdrawal: userId={}, failedCount={}", userId, failedCount);
                }
            }
        });
    }
}
