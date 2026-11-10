package kr.co.fitdining.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.hikari.maximum-pool-size=2",
    "APP_ENV=dev", "auth.simple.enabled=true",
    "SPRING_DATA_REDIS_HOST=redis-dev", "SPRING_DATA_REDIS_PORT=6379", "SPRING_DATA_REDIS_PASSWORD=test-redis",
    "auth.simple.dev-key=12345678901234567890123456789012", "AUTH_DEMO_PASSWORD=password1",
    "AUTH_DEMO_EMAIL=dev-server@fitdining.local", "AUTH_DEMO_NICKNAME=서버개발자",
    "SPRING_DATASOURCE_URL=jdbc:postgresql://localhost/fit_dev",
    "SPRING_DATASOURCE_USERNAME=test", "SPRING_DATASOURCE_PASSWORD=test"})
@AutoConfigureMockMvc
class DevSimpleAuthTests extends PostgresTestSupport {
    @Autowired MockMvc mvc;

    @Test @DisplayName("dev 간소 로그인_Origin 없음_403")
    void login_withoutOrigin_forbidden() throws Exception {
        mvc.perform(post("/api/auth/login").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType("application/json")
                .content("{\"email\":\"dev-server@fitdining.local\",\"password\":\"password1\"}"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("dev 개발 토큰_Origin 없이 올바른 키_쿠키와 보호 API 성공")
    void devToken_validKeyWithoutOrigin_returnsUsableToken() throws Exception {
        var response = mvc.perform(post("/api/auth/dev/token")
                .header("X-Dev-Key", "12345678901234567890123456789012"))
                .andExpect(status().isOk())
                .andExpect(cookie().httpOnly("fitdining_session", true))
                .andReturn().getResponse();
        mvc.perform(get("/api/auth/me").cookie(response.getCookie("fitdining_session")))
                .andExpect(status().isOk());
    }

    @Test @DisplayName("dev 개발 토큰_틀린 키_403")
    void devToken_wrongKey_forbidden() throws Exception {
        mvc.perform(post("/api/auth/dev/token").header("X-Dev-Key", "wrong"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("dev 개발 토큰_키 누락_403")
    void devToken_missingKey_forbidden() throws Exception {
        mvc.perform(post("/api/auth/dev/token")).andExpect(status().isForbidden());
    }
}
