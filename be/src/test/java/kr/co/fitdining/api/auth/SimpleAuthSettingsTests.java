package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import kr.co.fitdining.api.auth.infrastructure.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;

class SimpleAuthSettingsTests {
    MockEnvironment serverEnvironment(String key) {
        return environment().withProperty("APP_ENV", "dev")
                .withProperty("auth.simple.dev-key", key)
                .withProperty("auth.jwt-secret", java.util.Base64.getEncoder().encodeToString(new byte[32]))
                .withProperty("AUTH_DEMO_PASSWORD", "password1");
    }

    @Test @DisplayName("서버 간소 설정_31자 개발 키_기동 거부")
    void settings_serverShortKey_rejected() {
        var failure = assertThrows(IllegalArgumentException.class,
                () -> AuthSettings.load(serverEnvironment("k".repeat(31))));
        assertEquals("AUTH_DEV_KEY requires at least 32 characters on servers", failure.getMessage());
    }

    @Test @DisplayName("서버 간소 설정_32자 개발 키_허용")
    void settings_serverMinimumKey_accepted() {
        assertEquals("k".repeat(32), AuthSettings.load(serverEnvironment("k".repeat(32))).devKey());
    }

    @Test @DisplayName("로컬 간소 설정_짧은 개발 키_허용")
    void settings_localShortKey_accepted() {
        assertEquals("k", AuthSettings.load(environment().withProperty("auth.simple.dev-key", "k")).devKey());
    }

    MockEnvironment environment() {
        return new MockEnvironment().withProperty("auth.simple.enabled", "true")
                .withProperty("auth.frontend-origin", "http://localhost:3000")
                .withProperty("auth.cookie-secure", "false");
    }
    @Test @DisplayName("로컬 간소 설정_비밀값 없음_개발 키와 데모 기본값")
    void settings_local_defaults() {
        var settings = AuthSettings.load(environment());
        assertTrue(settings.signingKey().length >= 32);
        assertEquals("dev@fitdining.local", settings.demoEmail());
        assertEquals("개발자", settings.demoNickname());
        assertNull(settings.devKey());
        assertFalse(new SimpleAuthPolicy(true).checkOrigin());
        assertTrue(new SimpleAuthPolicy(false).checkOrigin());
    }
    @Test @DisplayName("서버 간소 설정_키 누락_기동 거부")
    void settings_serverMissingKey_rejected() {
        assertThrows(IllegalArgumentException.class, () -> AuthSettings.load(environment().withProperty("APP_ENV", "dev")));
    }
    @Test @DisplayName("Strict 설정_서명 키 누락_기동 거부")
    void settings_strictMissingSecret_rejected() {
        assertThrows(IllegalArgumentException.class, () -> AuthSettings.load(environment().withProperty("auth.simple.enabled", "false")));
    }
}
