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
    "auth.simple.enabled=true", "auth.simple.dev-key=", "auth.jwt-secret="})
@AutoConfigureMockMvc
class LocalKeylessSimpleAuthTests extends PostgresTestSupport {
    @Autowired MockMvc mvc;

    @Test @DisplayName("로컬 개발 토큰_키 미설정 및 헤더 없음_200")
    void devToken_unconfiguredKeyWithoutHeader_succeeds() throws Exception {
        mvc.perform(post("/api/auth/dev/token")).andExpect(status().isOk())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("HttpOnly")));
    }
}
