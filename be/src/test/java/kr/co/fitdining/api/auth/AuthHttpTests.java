package kr.co.fitdining.api.auth;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Clock;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.presentation.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = AuthController.class, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@Import({AuthWebConfiguration.class, AuthHttpTests.Configuration.class})
class AuthHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    static class Configuration { @Bean Clock authClock() { return Clock.systemUTC(); } }
    @Autowired MockMvc mvc;
    @MockitoBean AuthUseCases auth;

    @Test @DisplayName("인터셉터_AT 만료_401 type 전달")
    void authenticate_expiredAccess_returnsExpiryType() throws Exception {
        when(auth.authenticate("expired")).thenThrow(AuthFailure.accessExpired());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer expired"))
                .andExpect(status().isUnauthorized()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.type").value(AuthFailure.ACCESS_TOKEN_EXPIRED.toString()))
                .andExpect(jsonPath("$.code").doesNotExist()).andExpect(header().string("Cache-Control", "no-store"));
    }
    @Test @DisplayName("갱신_인증 실패_쿠키 삭제와 일반 401")
    void refresh_invalidToken_clearsCookie() throws Exception {
        when(auth.refresh(any())).thenThrow(new AuthFailure("internal reason"));
        mvc.perform(post("/api/auth/refresh").header("Origin", "http://localhost:3000"))
                .andExpect(status().isUnauthorized()).andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")))
                .andExpect(jsonPath("$.detail").value("인증을 확인해주세요."))
                .andExpect(jsonPath("$.type").doesNotExist());
    }
    @Test @DisplayName("로그인_시도 제한_Retry-After 유지")
    void login_rateLimited_returnsRetryAfter() throws Exception {
        when(auth.login(any(), any(), any())).thenThrow(new AuthFailure("internal reason",429));
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000").contentType("application/json").content("{\"username\":\"demo\",\"password\":\"test-password\"}"))
                .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "900"));
    }
    @Test @DisplayName("인터셉터_DB 장애_503 일반 문구")
    void authenticate_storageFailure_returnsUnavailable() throws Exception {
        when(auth.authenticate(any())).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("internal database details"));
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer token"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.detail").value("인증 저장소를 사용할 수 없습니다."));
    }
    @Test @DisplayName("로그인_깨진 JSON_400 ProblemDetail")
    void login_malformedBody_returnsBadRequest() throws Exception {
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000").contentType("application/json").content("{"))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }
    @Test @DisplayName("인터셉터_다른 Origin_403 일반 문구")
    void login_untrustedOrigin_returnsForbidden() throws Exception {
        mvc.perform(post("/api/auth/login").header("Origin", "https://untrusted.example").contentType("application/json").content("{\"username\":\"demo\",\"password\":\"test-password\"}"))
                .andExpect(status().isForbidden()).andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        verifyNoInteractions(auth);
    }
    @Test @DisplayName("로그인_필수 필드 생략_400 ProblemDetail")
    void login_missingFields_returnsBadRequest() throws Exception {
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000").contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        verifyNoInteractions(auth);
    }

    @Test @DisplayName("로그인_지원하지 않는 미디어 형식_415 ProblemDetail")
    void login_unsupportedContentType_returnsProblemDetail() throws Exception {
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000").contentType("text/plain").content("hello"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }
    @Test @DisplayName("인증 경로_매핑 없는 요청_인증 예외 없이 404 반환")
    void auth_unknownMapping_doesNotThrowInterceptorFailure() throws Exception {
        mvc.perform(post("/api/auth/unknown")).andExpect(status().isNotFound());
        verifyNoInteractions(auth);
    }

}
