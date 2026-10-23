package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import javax.sql.DataSource;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import kr.co.fitdining.api.auth.application.AuthTransactions;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import static org.mockito.Mockito.mock;
import org.springframework.jdbc.datasource.*;
import kr.co.fitdining.api.auth.infrastructure.AuthConfiguration;
import kr.co.fitdining.api.auth.presentation.AuthWebConfiguration;

class AuthConfigurationTests {
    private WebApplicationContextRunner runner(Map<String,String> values) {
        return new WebApplicationContextRunner().withUserConfiguration(AuthConfiguration.class)
                .withBean(AuthUseCases.class, () -> mock(AuthUseCases.class))
                .withBean(AuthTransactions.class, () -> mock(AuthTransactions.class))
                .withPropertyValues("auth.jwt-secret=${JWT_SECRET}", "auth.frontend-origin=${AUTH_FRONTEND_ORIGIN}", "auth.cookie-secure=${AUTH_COOKIE_SECURE}")
                .withPropertyValues(values.entrySet().stream().map(e -> e.getKey()+"="+e.getValue()).toArray(String[]::new));
    }
    private Map<String,String> valid() {
        return new HashMap<>(Map.of("JWT_SECRET", Base64.getEncoder().encodeToString(new byte[32]),
                "AUTH_FRONTEND_ORIGIN", "http://localhost:3000", "AUTH_COOKIE_SECURE", "false"));
    }
    @ParameterizedTest @ValueSource(strings={"JWT_SECRET","AUTH_FRONTEND_ORIGIN","AUTH_COOKIE_SECURE"})
    @DisplayName("설정_필수 환경변수 누락_기동 거부")
    void startup_missingRequiredValue_fails(String key) {
        var values=valid(); values.remove(key); runner(values).run(context -> assertThat(context).hasFailed());
    }
    @ParameterizedTest @ValueSource(strings={"JWT_SECRET","AUTH_FRONTEND_ORIGIN","AUTH_COOKIE_SECURE"})
    @DisplayName("설정_필수 환경변수 빈 값_기동 거부")
    void startup_blankRequiredValue_fails(String key) {
        var values=valid(); values.put(key, ""); runner(values).run(context -> assertThat(context).hasFailed());
    }
    @Test @DisplayName("설정_짧은 서명 키_기동 거부") void startup_shortSecret_fails() {
        var values=valid(); values.put("JWT_SECRET", "c2hvcnQ="); runner(values).run(context -> assertThat(context).hasFailed());
    }
    @Test @DisplayName("설정_잘못된 쿠키 값_기동 거부") void startup_invalidCookieBoolean_fails() {
        var values=valid(); values.put("AUTH_COOKIE_SECURE", "yes"); runner(values).run(context -> assertThat(context).hasFailed());
    }
    @Test @DisplayName("설정_정상 필수 값과 데모 계정 생략_기동 허용") void startup_validRequiredValues_succeeds() {
        runner(valid()).run(context -> assertThat(context).hasNotFailed());
    }
    @Test @DisplayName("설정_데모 사용자만 지정_기동 거부") void startup_partialDemoCredentials_fails() {
        var values=valid(); values.put("AUTH_DEMO_USERNAME", "demo"); runner(values).run(context -> assertThat(context).hasFailed());
    }
    @Test @DisplayName("설정_짧은 데모 비밀번호_기동 거부") void startup_shortDemoPassword_fails() {
        var values=valid(); values.put("AUTH_DEMO_USERNAME", "demo"); values.put("AUTH_DEMO_PASSWORD", "short");
        runner(values).run(context -> assertThat(context).hasFailed());
    }
}
