package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import kr.co.fitdining.api.auth.ports.*;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.*;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.hikari.maximum-pool-size=2",
    "auth.simple.enabled=true", "auth.simple.dev-key=test-dev-key", "auth.jwt-secret="})
@AutoConfigureMockMvc
class SimpleAuthTests extends PostgresTestSupport {
    @Autowired AuthUseCases auth;
    @Autowired TokenCodec codec;
    @Autowired MockMvc mvc;
    @Autowired AuthSettings settings;
    @Autowired PasswordHasher passwords;
    @Autowired AuthPolicy policy;
    @Autowired String authDummyHash;

    @Test @DisplayName("간소 로그인_21회 반복_제한과 시도 기록 없음")
    void login_repeated_succeedsWithoutAttempts() {
        JdbcTemplate jdbc = new JdbcTemplate(appSource());
        int before = jdbc.queryForObject("select count(*) from auth_login_attempts", Integer.class);
        for (int i = 0; i < 21; i++) auth.login(settings.demoEmail(), settings.demoPassword(), "simple-ip");
        assertEquals(before, jdbc.queryForObject("select count(*) from auth_login_attempts", Integer.class));
    }

    @Test @DisplayName("간소 갱신_사용한 RT 재사용_같은 family 유지 및 이벤트 없음")
    void refresh_reused_keepsFamilyWithoutEvents() {
        var first = auth.login(settings.demoEmail(), settings.demoPassword(), "simple-refresh");
        var second = auth.refresh(first.refreshToken());
        var third = auth.refresh(first.refreshToken());
        assertEquals(first.identity().sessionId(), second.identity().sessionId());
        assertEquals(first.identity().sessionId(), third.identity().sessionId());
        JdbcTemplate jdbc = new JdbcTemplate(appSource());
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_security_events where family_id = ?", Integer.class, first.identity().sessionId()));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where family_id = ? and revoked_at is not null", Integer.class, first.identity().sessionId()));
    }

    @Test @DisplayName("간소 로그아웃_이전 RT와 새 RT_모두 거부")
    void logout_family_rejectsAllTokens() {
        var first = auth.login(settings.demoEmail(), settings.demoPassword(), "simple-logout");
        var second = auth.refresh(first.refreshToken());
        auth.logout(second.refreshToken());
        assertThrows(AuthFailure.class, () -> auth.refresh(first.refreshToken()));
        assertThrows(AuthFailure.class, () -> auth.refresh(second.refreshToken()));
    }

    @Test @DisplayName("간소 토큰_발급_12시간 AT와 30일 세션")
    void login_tokens_haveSimpleLifetimes() {
        var issued = auth.login(settings.demoEmail(), settings.demoPassword(), "simple-ttl");
        long now = java.time.Instant.now().getEpochSecond();
        assertTrue(Math.abs(issued.identity().accessExpiresAt() - now - 43200) <= 2);
        assertTrue(Math.abs(issued.identity().sessionExpiresAt() - now - 2592000) <= 2);
        assertInstanceOf(SimpleAuthPolicy.class, policy);
        assertEquals("", authDummyHash);
        assertTrue(passwords.hash("password1").startsWith("$2a$04$"));
    }

    @Test @DisplayName("개발 토큰_올바른 키와 본문 없음_쿠키와 보호 API 성공")
    void devToken_validKey_returnsUsableToken() throws Exception {
        var response = mvc.perform(post("/api/auth/dev/token").header("X-Dev-Key", "test-dev-key"))
                .andExpect(status().isOk()).andExpect(cookie().httpOnly("fitdining_rt", true))
                .andReturn().getResponse();
        String body = response.getContentAsString();
        mvc.perform(get("/api/auth/me").cookie(response.getCookie("fitdining_session")))
                .andExpect(status().isOk());
        String token = new tools.jackson.databind.ObjectMapper().readTree(body).get("accessToken").asString();
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
    }

    @Test @DisplayName("개발 토큰_틀린 키 또는 누락_403")
    void devToken_wrongOrMissingKey_forbidden() throws Exception {
        mvc.perform(post("/api/auth/dev/token")).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/dev/token").header("X-Dev-Key", "wrong")).andExpect(status().isForbidden());
    }

    @Test @DisplayName("로컬 로그인_Origin 없음_성공")
    void login_localWithoutOrigin_succeeds() throws Exception {
        mvc.perform(post("/api/auth/login").contentType("application/json")
                .content("{\"email\":\"dev@fitdining.local\",\"password\":\"fitdining-dev1\"}"))
                .andExpect(status().isOk());
    }

    @Test @DisplayName("개발 토큰_없는 계정_404")
    void devToken_unknownAccount_notFound() throws Exception {
        mvc.perform(post("/api/auth/dev/token").header("X-Dev-Key", "test-dev-key")
                .contentType("application/json").content("{\"email\":\"missing@example.com\"}"))
                .andExpect(status().isNotFound());
    }
}
