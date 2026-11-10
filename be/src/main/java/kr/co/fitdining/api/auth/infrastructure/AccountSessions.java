package kr.co.fitdining.api.auth.infrastructure;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Public account lifecycle hook; Redis changes happen only after the database commits. */
@Component
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
                sessions.findByPrincipalName(userId).keySet().forEach(sessions::deleteById);
            }
        });
    }
}
