package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.SimpleAuthPolicy;
import kr.co.fitdining.api.auth.ports.*;
import kr.co.fitdining.api.auth.repository.*;
import org.junit.jupiter.api.*;

class SimpleAuthUnitTests {
    @Test @DisplayName("간소 시도 기록_이메일 및 소셜 공통_저장소 호출 없음")
    void recordAttempt_simple_neverTouchesRepository() {
        var attempts = mock(AuthLoginAttemptRepository.class);
        var transactions = new AuthTransactions(attempts, mock(AuthRefreshTokenRepository.class),
                mock(AuthSecurityEventRepository.class), mock(AuthUserRepository.class),
                mock(kr.co.fitdining.api.user.UserPreferencesRepository.class), mock(TokenCodec.class),
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
        var service = new AuthService(transactions, mock(AuthUserRepository.class), passwords,
                mock(TokenCodec.class), "", new SimpleAuthPolicy(true));
        assertThrows(AuthFailure.class, () -> service.login("missing@example.com", "password1", "ip"));
        verifyNoInteractions(passwords);
    }
}
