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
@Import({AuthRefreshCookieWriter.class, kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration.class, AuthHttpTests.Configuration.class})
class AuthHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    static class Configuration { @Bean Clock authClock() { return Clock.systemUTC(); } }
    @Autowired MockMvc mvc;
    @MockitoBean AuthUseCases auth;

    @Test @DisplayName("가입_규칙 위반_필드별 400 오류")
    void signup_invalidFields_returnsFieldErrors() throws Exception {
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("""
                    {"email":"invalid","password":"short","nickname":"a",
                     "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                    """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[*].field", org.hamcrest.Matchers.containsInAnyOrder("email", "password", "nickname")));
        verifyNoInteractions(auth);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
        "null", "{}", "{\"ageOver14\":false,\"terms\":true,\"privacy\":true}",
        "{\"ageOver14\":true,\"terms\":false,\"privacy\":true}",
        "{\"ageOver14\":true,\"terms\":true,\"privacy\":false}"})
    @DisplayName("가입_약관 누락과 미동의_400 오류")
    void signup_missingAgreement_returnsBadRequest(String agreements) throws Exception {
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"email\":\"new@example.com\",\"password\":\"password1\",\"nickname\":\"new\",\"agreements\":" + agreements + "}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors").isArray());
        verifyNoInteractions(auth);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"en-US", "ko-KR", "fr-FR"})
    @DisplayName("가입_약관 누락과 미동의_로캘과 무관한 고정 오류 문구")
    void signup_invalidAgreements_returnsStableReasons(String locale) throws Exception {
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000").header("Accept-Language", locale)
                .contentType("application/json").content("""
                    {"email":"new@example.com","password":"password1","nickname":"new",
                     "agreements":{"ageOver14":false,"terms":null}}
                    """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[*].reason", org.hamcrest.Matchers.containsInAnyOrder(
                        "만 14세 이상 확인에 동의해 주세요.", "서비스 이용약관에 동의해 주세요.", "개인정보 수집·이용에 동의해 주세요.")));
        verifyNoInteractions(auth);
    }

    @Test @DisplayName("가입_약관 객체 누락_고정 오류 문구")
    void signup_missingAgreementObject_returnsStableReason() throws Exception {
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000").header("Accept-Language", "en-US")
                .contentType("application/json").content("""
                    {"email":"new@example.com","password":"password1","nickname":"new"}
                    """))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].reason").value("필수 약관에 모두 동의해 주세요."));
        verifyNoInteractions(auth);
    }

    @Test @DisplayName("가입_시도 제한_429와 Retry-After")
    void signup_rateLimited_returnsRetryAfter() throws Exception {
        when(auth.signup(any(), any(), any(), any(), any())).thenThrow(new AuthFailure("limited", 429));
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("""
                    {"email":"new@example.com","password":"password1","nickname":"new",
                     "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                    """))
                .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "900"));
    }

    @Test @DisplayName("로그아웃_다른 Origin_쿠키 인증 전에 403")
    void logout_untrustedOrigin_returnsForbidden() throws Exception {
        mvc.perform(post("/api/auth/logout").header("Origin", "http://evil.example"))
                .andExpect(status().isForbidden());
        verifyNoInteractions(auth);
    }

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
                .andExpect(status().isUnauthorized()).andExpect(cookie().maxAge("fitdining_rt", 0))
                .andExpect(jsonPath("$.detail").value("인증을 확인해주세요."))
                .andExpect(jsonPath("$.type").doesNotExist());
    }
    @Test @DisplayName("로그인_시도 제한_Retry-After 유지")
    void login_rateLimited_returnsRetryAfter() throws Exception {
        when(auth.login(any(), any(), any())).thenThrow(new AuthFailure("internal reason",429));
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000").contentType("application/json").content("{\"email\":\"demo@example.com\",\"password\":\"test-password\"}"))
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
        mvc.perform(post("/api/auth/login").header("Origin", "https://untrusted.example").contentType("application/json").content("{\"email\":\"demo@example.com\",\"password\":\"test-password\"}"))
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
        mvc.perform(post("/api/auth/unknown").header("Origin", "http://localhost:3000"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(auth);
    }


    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"email", "password", "nickname"})
    void signup_overMaximum_returnsFieldError(String field) throws Exception {
        String email = field.equals("email") ? "a".repeat(243) + "@example.com" : "new@example.com";
        String password = field.equals("password") ? "abc1" + "\uac00".repeat(23) : "password1";
        String nickname = field.equals("nickname") ? "a".repeat(16) : "new";
        String body = """
            {"email":"%s","password":"%s","nickname":"%s",
             "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
            """.formatted(email, password, nickname);
        mvc.perform(post("/api/auth/signup").header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[*].field", org.hamcrest.Matchers.contains(field)));
        verifyNoInteractions(auth);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"ascii", "multibyte"})
    void login_overMaximumPassword_preservesExistingFailure(String kind) throws Exception {
        // Use the real early validation branch; no service dependencies are used for invalid input.
        when(auth.login(any(), any(), any())).thenAnswer(invocation ->
                new kr.co.fitdining.api.auth.application.AuthService(null, null, null, null, null, null, null, null)
                        .login(invocation.getArgument(0), invocation.getArgument(1), invocation.getArgument(2)));
        String password = kind.equals("ascii") ? "a1" + "a".repeat(71) : "abc1" + "\uac00".repeat(23);
        mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000")
                .contentType("application/json")
                .content("{\"email\":\"demo@example.com\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.detail").value("\uC785\uB825 \uD615\uC2DD\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694."));
        verify(auth).login(eq("demo@example.com"), eq(password), any());
    }
}
