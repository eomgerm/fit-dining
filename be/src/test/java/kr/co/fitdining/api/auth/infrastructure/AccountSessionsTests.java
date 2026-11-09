package kr.co.fitdining.api.auth.infrastructure;

import static org.mockito.Mockito.*;
import static org.assertj.core.api.Assertions.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.MapSession;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class AccountSessionsTests {
    @Test @SuppressWarnings({"rawtypes", "unchecked"})
    void redisIsUntouchedUntilDatabaseCommit() {
        var repository = mock(FindByIndexNameSessionRepository.class);
        var hook = new AccountSessions(repository);
        assertThatThrownBy(() -> hook.invalidateAfterCommit("user")).isInstanceOf(IllegalStateException.class);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            hook.invalidateAfterCommit("user");
            verifyNoInteractions(repository);
            when(repository.findByPrincipalName("user")).thenReturn(Map.of("one", new MapSession(), "two", new MapSession()));
            TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
            verify(repository).deleteById("one");
            verify(repository).deleteById("two");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }
    @Test @SuppressWarnings("rawtypes")
    void rollbackDoesNotDeleteSessions() {
        var repository = mock(FindByIndexNameSessionRepository.class);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            new AccountSessions(repository).invalidateAfterCommit("user");
            TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCompletion(1));
            verifyNoInteractions(repository);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }
}
