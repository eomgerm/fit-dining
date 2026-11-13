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
    void attemptsEveryDeletionAndLogsOnlyUserIdAndFailureCount() {
        var repository = mock(FindByIndexNameSessionRepository.class);
        var stored = new java.util.LinkedHashMap<String, MapSession>();
        stored.put("sensitive-first-session", new MapSession());
        stored.put("sensitive-second-session", new MapSession());
        stored.put("sensitive-third-session", new MapSession());
        when(repository.findByPrincipalName("user")).thenReturn(stored);
        for (String id : java.util.List.of("sensitive-first-session", "sensitive-third-session")) {
            doThrow(new org.springframework.data.redis.RedisConnectionFailureException("sensitive-exception-message " + id))
                    .when(repository).deleteById(id);
        }
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(AccountSessions.class);
        var logs = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            new AccountSessions(repository, mock(kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository.class),
                    java.time.Clock.systemUTC()).invalidateAfterCommit("user");
            assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit()))
                    .doesNotThrowAnyException();
            var order = inOrder(repository);
            order.verify(repository).findByPrincipalName("user");
            order.verify(repository).deleteById("sensitive-first-session");
            order.verify(repository).deleteById("sensitive-second-session");
            order.verify(repository).deleteById("sensitive-third-session");
            assertThat(logs.list).hasSize(1);
            var event = logs.list.getFirst();
            assertThat(event.getLevel()).isEqualTo(ch.qos.logback.classic.Level.WARN);
            assertThat(event.getArgumentArray()).containsExactly("user", 2);
            assertThat(event.getThrowableProxy()).isNull();
            assertThat(event.getFormattedMessage()).contains("failedCount=2").doesNotContain("sensitive-");
        } finally {
            logger.detachAppender(logs); logs.stop();
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }
    @Test @SuppressWarnings({"rawtypes", "unchecked"})
    void deletionFailureAfterCommitDoesNotEscape() {
        var repository = mock(FindByIndexNameSessionRepository.class);
        when(repository.findByPrincipalName("user")).thenReturn(Map.of("one", new MapSession()));
        doThrow(new org.springframework.data.redis.RedisConnectionFailureException("sensitive-session-id"))
                .when(repository).deleteById("one");
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            new AccountSessions(repository, mock(kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository.class),
                    java.time.Clock.systemUTC()).invalidateAfterCommit("user");
            assertThatCode(() -> TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit()))
                    .doesNotThrowAnyException();
            verify(repository).deleteById("one");
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }
    @Test @SuppressWarnings({"rawtypes", "unchecked"})
    void redisIsUntouchedUntilDatabaseCommit() {
        var repository = mock(FindByIndexNameSessionRepository.class);
        var hook = new AccountSessions(repository, mock(kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository.class), java.time.Clock.systemUTC());
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
            new AccountSessions(repository, mock(kr.co.fitdining.api.auth.repository.AuthSecurityEventRepository.class), java.time.Clock.systemUTC()).invalidateAfterCommit("user");
            TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCompletion(1));
            verifyNoInteractions(repository);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
            TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }
}
