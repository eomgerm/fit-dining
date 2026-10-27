package kr.co.fitdining.api.config;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.*;

class SimpleAuthEnvTests {
    Map<String, String> environment(String name) {
        return new HashMap<>(Map.of("APP_ENV", name, "SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres/fit_" + name,
                "SPRING_DATASOURCE_USERNAME", "user", "SPRING_DATASOURCE_PASSWORD", "password"));
    }
    @Test @DisplayName("prod 계약_간소 모드 활성화_거부")
    void validate_prodSimple_rejected() {
        var env = environment("prod"); env.put("AUTH_SIMPLE_ENABLED", "true");
        assertFalse(EnvContractValidator.validate(env::get, Set.of("prod")).isEmpty());
    }
    @Test @DisplayName("prod 계약_개발 키 설정_거부")
    void validate_prodKey_rejected() {
        var env = environment("prod"); env.put("AUTH_DEV_KEY", "secret");
        assertFalse(EnvContractValidator.validate(env::get, Set.of("prod")).isEmpty());
    }
    @Test @DisplayName("dev 계약_간소 키 누락과 자리표시자_거부")
    void validate_devMissingKey_rejected() {
        var env = environment("dev"); env.put("AUTH_SIMPLE_ENABLED", "true"); env.put("AUTH_DEMO_PASSWORD", "password1");
        for (String key : List.of("", "REPLACE_ME")) {
            env.put("AUTH_DEV_KEY", key);
            assertFalse(EnvContractValidator.validate(env::get, Set.of("dev")).isEmpty());
        }
        env.put("AUTH_DEV_KEY", "k".repeat(32));
        assertTrue(EnvContractValidator.validate(env::get, Set.of("dev")).isEmpty());
    }

    @Test @DisplayName("dev 계약_31자 개발 키_거부")
    void validate_devShortKey_rejected() {
        var env = environment("dev");
        env.put("AUTH_SIMPLE_ENABLED", "true");
        env.put("AUTH_DEMO_PASSWORD", "password1");
        env.put("AUTH_DEV_KEY", "k".repeat(31));
        assertEquals(List.of("AUTH_DEV_KEY는 32자 이상이어야 한다"),
                EnvContractValidator.validate(env::get, Set.of("dev")));
    }

    @Test @DisplayName("dev 계약_데모 비밀번호 누락_거부")
    void validate_devMissingDemoPassword_rejected() {
        var env = environment("dev");
        env.put("AUTH_SIMPLE_ENABLED", "true");
        env.put("AUTH_DEV_KEY", "k".repeat(32));
        assertEquals(List.of("AUTH_DEMO_PASSWORD 값이 없거나 REPLACE_ME다"),
                EnvContractValidator.validate(env::get, Set.of("dev")));
    }
}
