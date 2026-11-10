package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import kr.co.fitdining.api.auth.application.*;
import java.time.*;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthEmailVerification;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.SimpleAuthPolicy;
import kr.co.fitdining.api.auth.ports.*;
import kr.co.fitdining.api.auth.repository.*;
import org.junit.jupiter.api.*;

class SimpleAuthUnitTests {
    @Test @DisplayName("간소 시도 기록_이메일 및 소셜 공통_저장소 호출 없음")
    void recordAttempt_simple_neverTouchesRepository() {
        var attempts = mock(AuthLoginAttemptRepository.class);
        var transactions = new AuthTransactions(attempts, mock(AuthSecurityEventRepository.class), mock(AuthUserRepository.class),
                mock(AuthEmailVerificationRepository.class),
                mock(kr.co.fitdining.api.user.UserPreferencesRepository.class),
                java.time.Clock.systemUTC(), new SimpleAuthPolicy(true));
        assertTrue(transactions.recordAttempt("ip", "login"));
        assertTrue(transactions.recordAttempt("ip", "signup"));
        verifyNoInteractions(attempts);
    }
    @Test @DisplayName("간소 로그인_모르는 계정_dummy 비교 없음")
    void login_unknownAccount_doesNotCompareDummy() {
        var transactions = mock(AuthTransactions.class);
        when(transactions.recordAttempt("ip", "login")).thenReturn(true);
        var passwords = mock(PasswordHasher.class);
        var service = new AuthService(transactions, mock(kr.co.fitdining.api.onboarding.TasteProfileService.class), mock(AuthUserRepository.class), passwords,
                "", new SimpleAuthPolicy(true), mock(EmailVerifications.class));
        assertThrows(AuthFailure.class, () -> service.login("missing@example.com", "password1", "ip"));
        verifyNoInteractions(passwords);
    }
    @Test @DisplayName("간소 인증번호 발송_주소별 15분 10회 초과_거절")
    void recordSend_simpleOverAddressLimit_rejects() {
        var attempts = mock(AuthLoginAttemptRepository.class);
        when(attempts.countByAddressAndActionAndCreatedAtAfter(eq("ip"), eq("verify_send"), any())).thenReturn(9L, 10L);
        var transactions = emailTransactions(mock(AuthEmailVerificationRepository.class), attempts);
        assertTrue(transactions.recordSend("ip"));
        assertFalse(transactions.recordSend("ip"));
        verify(attempts, times(1)).save(any());
    }
    @Test @DisplayName("간소 인증번호 확인_주소별 제한_저장소 호출 없음")
    void recordConfirm_simple_neverTouchesRepository() {
        var attempts = mock(AuthLoginAttemptRepository.class);
        assertTrue(emailTransactions(mock(AuthEmailVerificationRepository.class), attempts).recordConfirm("ip"));
        verifyNoInteractions(attempts);
    }
    @Test @DisplayName("간소 인증번호 발송_60초 안에 다시 요청_429와 남은 시간")
    void issue_simpleWithinResendWait_isLimited() {
        var verifications = mock(AuthEmailVerificationRepository.class);
        when(verifications.findTopByEmailOrderByCreatedAtDescIdDesc("a@example.com")).thenReturn(Optional.of(
                new AuthEmailVerification("a@example.com", "hash", NOW.minusSeconds(30), NOW.plusSeconds(570))));
        var failure = assertThrows(AuthFailure.class,
                () -> emailTransactions(verifications, mock(AuthLoginAttemptRepository.class)).issue("a@example.com", "hash"));
        assertEquals(429, failure.status());
        assertEquals(31, failure.retryAfterSeconds());
        verify(verifications, never()).saveAndFlush(any());
    }
    @Test @DisplayName("간소 인증번호 발송_이메일별 1시간 5회 초과_429")
    void issue_simpleOverEmailHourlyLimit_isLimited() {
        var verifications = mock(AuthEmailVerificationRepository.class);
        when(verifications.findTopByEmailOrderByCreatedAtDescIdDesc("a@example.com")).thenReturn(Optional.empty());
        when(verifications.countByEmailAndCreatedAtAfter(eq("a@example.com"), any())).thenReturn(5L);
        var failure = assertThrows(AuthFailure.class,
                () -> emailTransactions(verifications, mock(AuthLoginAttemptRepository.class)).issue("a@example.com", "hash"));
        assertEquals(429, failure.status());
        verify(verifications, never()).saveAndFlush(any());
    }
    private static final Instant NOW = Instant.parse("2026-11-03T00:00:00Z");
    private static EmailVerificationTransactions emailTransactions(AuthEmailVerificationRepository verifications,
            AuthLoginAttemptRepository attempts) {
        return new EmailVerificationTransactions(verifications, attempts, Clock.fixed(NOW, ZoneOffset.UTC), new SimpleAuthPolicy(true));
    }
}
