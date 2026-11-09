package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.*;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.presentation.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.web.util.UriUtils;

@WebMvcTest(controllers = {
    SocialAuthController.class, AuthController.class
}, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"
})
@Import({
    AuthRefreshCookieWriter.class, kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration.class, SocialHttpTests.Configuration.class
})
@ExtendWith(OutputCaptureExtension.class)
class SocialHttpTests {
    @TestConfiguration
    static class Configuration {
        @Bean Clock clock() {
            return Clock.systemUTC();
        }

        @Bean AuthSettings settings() {
            return new AuthSettings(new byte[32], "http://localhost:3000", false, null, null, null);
        }

        @Bean SocialProviders providers() {
            return new SocialProviders(new MockEnvironment().withProperty("AUTH_GOOGLE_CLIENT_ID", "client-id").withProperty("AUTH_GOOGLE_CLIENT_SECRET", "secret"));
        }

        @Bean SocialTokens tokens(Clock clock) {
            return new SocialTokens(new NimbusTokenCodec(new byte[32], clock), clock);
        }
    }

    @Autowired MockMvc mvc;
    @Autowired SocialTokens tokens;
    @MockitoSpyBean SocialProviders providers;
    @MockitoBean AuthUseCases auth;
    @MockitoBean SocialProviderClient client;
    @MockitoBean SocialAccounts accounts;
    @MockitoBean AuthTransactions transactions;

    @BeforeEach
    void allow() {
        when(transactions.recordAttempt(any(), any())).thenReturn(true);
    }

    @Test
    @DisplayName("인가시작_구글_주소와 Lax 서명쿠키 발급")
    void start_google_setsCookieAndPkce() throws Exception {
        var result = mvc.perform(get("/api/auth/oauth/google").param("from", "signup"))
            .andExpect(status().isFound()).andExpect(header().string("Cache-Control", "no-store")).andReturn();
        String location = result.getResponse().getHeader("Location");
        assertTrue(location.contains("client_id=client-id"));
        assertTrue(location.contains("code_challenge="));
        assertTrue(location.contains("code_challenge_method=S256"));
        assertTrue(location.contains("redirect_uri="));
        Cookie cookie = result.getResponse().getCookie("fitdining_oauth");
        assertTrue(cookie.isHttpOnly());
        assertEquals("/api/auth/oauth", cookie.getPath());
        assertEquals(600, cookie.getMaxAge());
        assertTrue(result.getResponse().getHeaders("Set-Cookie").stream()
            .filter(value -> value.startsWith("fitdining_oauth=")).findFirst().orElseThrow().contains("SameSite=Lax"));
        assertEquals("signup", tokens.decode(cookie.getValue(), "oauth_state", 4)[3]);
    }

    @ParameterizedTest @ValueSource(strings = {
        "kakao", "unknown", "naver"
    })
    @DisplayName("인가시작_비활성과 알수없는 제공자_안전한 실패 이동")
    void start_disabled_redirects(String provider) throws Exception {
        mvc.perform(get("/api/auth/oauth/" + provider).param("from", "evil"))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/login?error=social"));
    }

    @ParameterizedTest @ValueSource(strings = {
        "missing", "tampered", "mismatch", "other", "cancel", "expired", "token", "profile", "limited"
    })
    @DisplayName("콜백_검증과 제공자 실패_쿠키 삭제 및 일반 실패 이동")
    void callback_invalid_redirectsWithoutSecrets(String scenario, CapturedOutput output) throws Exception {
        String signed = tokens.encode("oauth_state", scenario.equals("other") ? "kakao" : "google", "state", "verifier", "signup");
        if (scenario.equals("tampered")) signed += "x";
        if (scenario.equals("expired")) signed = new SocialTokens(new NimbusTokenCodec(new byte[32], Clock.offset(Clock.systemUTC(), Duration.ofMinutes(-11))), Clock.offset(Clock.systemUTC(), Duration.ofMinutes(-11))).encode("oauth_state", "google", "state", "verifier", "signup");
        when(client.exchange(any(), any(), any(), any(), any())).thenThrow(new IllegalArgumentException("sensitive-provider-response"));
        if (scenario.equals("limited")) when(transactions.recordAttempt(any(), any())).thenReturn(false);
        var request = get("/api/auth/oauth/google/callback").param("code", "secret-code").param("state", scenario.equals("mismatch") ? "wrong" : "state");
        if (!scenario.equals("missing")) request.cookie(new Cookie("fitdining_oauth", signed));
        if (scenario.equals("cancel")) request.param("error", "access_denied");
        var response = mvc.perform(request).andExpect(status().isFound()).andReturn().getResponse();
        assertEquals((Set.of("missing", "tampered", "expired").contains(scenario) ? "/login" : "/signup") + "?error=social", response.getHeader("Location"));
        assertEquals(0, response.getCookie("fitdining_oauth").getMaxAge());
        assertFalse(response.getContentAsString().contains("secret-code"));
        assertFalse(output.getAll().contains("secret-code"));
        assertFalse(output.getAll().contains("sensitive-provider-response"));
    }

    @Test
    @DisplayName("콜백_신규 사용자_가입 대기 Strict 쿠키")
    void callback_newIdentity_redirectsToSignup() throws Exception {
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn("subject");
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "signup"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/signup/social"))
            .andExpect(cookie().httpOnly("fitdining_social", true)).andExpect(cookie().path("fitdining_social", "/api/auth/social"));
    }

    AuthUseCases.Issued issued() {
        long now = Clock.systemUTC().instant().getEpochSecond();
        return new AuthUseCases.Issued("at", "rt", new AuthUseCases.Identity("id", "nickname", "family", now + 1800, now + 86400));
    }

    @Test
    @DisplayName("콜백_기존 사용자_RT 발급 후 데모 이동")
    void callback_existingIdentity_issuesRefresh() throws Exception {
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn("subject");
        when(accounts.existing(any(), any())).thenReturn(issued());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/")).andExpect(cookie().value("fitdining_rt", "rt"));
    }

    String body = "{\"nickname\":\"새닉네임\",\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}";
    @Test
    @DisplayName("소셜가입_정상 요청_201 토큰과 쿠키 삭제")
    void signup_valid_issuesTokens() throws Exception {
        when(accounts.signup(any(), any(), any())).thenReturn(issued());
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000").contentType("application/json").content(body.replace("\"nickname\":\"새닉네임\",", ""))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject"))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.userId").value("id")).andExpect(jsonPath("$.accessToken").value("at")).andExpect(cookie().maxAge("fitdining_social", 0));
    }

    @Test
    @DisplayName("소셜가입_쿠키 없음_401")
    void signup_missingCookie_rejects() throws Exception {
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000").contentType("application/json").content(body)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("소셜가입_다른 출처_403")
    void signup_untrustedOrigin_rejects() throws Exception {
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://evil.example").contentType("application/json").content(body)).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("소셜가입_기존 닉네임 입력은 무시")
    void signup_legacyNickname_isIgnored() throws Exception {
        when(accounts.signup(any(), any(), any())).thenReturn(issued());
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000")
            .contentType("application/json").content(body.replace("새닉네임", "a"))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject"))))
            .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("소셜가입_약관 미동의_400 약관 오류")
    void signup_unacceptedTerms_returnsAgreementError() throws Exception {
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000")
            .contentType("application/json").content(body.replace("\"terms\":true", "\"terms\":false"))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject"))))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.length()").value(1))
            .andExpect(jsonPath("$.errors[0].field").value("agreements.terms"));
    }

    @Test
    @DisplayName("소셜가입_시도 제한_429")
    void signup_limited_returnsRetryAfter() throws Exception {
        when(transactions.recordAttempt(any(), any())).thenReturn(false);
        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000").contentType("application/json").content(body)
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject"))))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "900"));
    }

    @ParameterizedTest @ValueSource(strings = {
        "tampered", "expired"
    })
    @DisplayName("소셜가입_위조와 만료 쿠키_401")
    void signup_invalidCookie_rejects(String scenario) throws Exception {
        String token = tokens.encode("social_signup", "google", "subject");
        if (scenario.equals("tampered")) token += "x";
        else {
            Clock old = Clock.offset(Clock.systemUTC(), Duration.ofMinutes(-11));
            token = new SocialTokens(new NimbusTokenCodec(new byte[32], old), old).encode("social_signup", "google", "subject");
        }

        mvc.perform(post("/api/auth/social/signup").header("Origin", "http://localhost:3000").contentType("application/json").content(body)
            .cookie(new Cookie("fitdining_social", token))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("프로필_소셜 사용자_이메일 필드 생략")
    void me_socialUser_omitsEmail() throws Exception {
        when(auth.authenticate(any())).thenReturn(issued().identity());
        when(auth.me(any())).thenReturn(new AuthUseCases.Profile("social", null));
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer at")).andExpect(status().isOk()).andExpect(jsonPath("$.email").doesNotExist());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "kakao", "naver"
    })
    @DisplayName("인가시작_카카오와 네이버_제공자별 PKCE 및 scope 정책")
    void start_enabledProvider_usesProviderParameters(String name) throws Exception {
        var env = new MockEnvironment()
            .withProperty("AUTH_" + name.toUpperCase(Locale.ROOT) + "_CLIENT_ID", "provider-client")
            .withProperty("AUTH_" + name.toUpperCase(Locale.ROOT) + "_CLIENT_SECRET", "provider-secret");
        var provider = new SocialProviders(env).get(name);
        doReturn(provider).when(providers).get(name);
        var response = mvc.perform(get("/api/auth/oauth/" + name).param("from", "signup"))
            .andExpect(status().isFound()).andReturn().getResponse();
        String location = response.getHeader("Location");
        assertTrue(location.startsWith(provider.authorization() + "?"));
        var query = UriComponentsBuilder.fromUriString(location).build().getQueryParams();
        assertEquals("provider-client", query.getFirst("client_id"));
        assertEquals("http://localhost:3000/api/auth/oauth/" + name + "/callback",
            UriUtils.decode(query.getFirst("redirect_uri"), StandardCharsets.UTF_8));
        assertEquals("code", query.getFirst("response_type"));
        assertFalse(query.containsKey("scope"));
        String[] payload = tokens.decode(response.getCookie("fitdining_oauth").getValue(), "oauth_state", 4);
        assertEquals(name, payload[0]);
        assertEquals(payload[1], query.getFirst("state"));
        if (name.equals("kakao")) {
            assertEquals("S256", query.getFirst("code_challenge_method"));
            String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(
                MessageDigest.getInstance("SHA-256").digest(payload[2].getBytes(StandardCharsets.US_ASCII)));
            assertEquals(expected, query.getFirst("code_challenge"));
        } else {
            assertFalse(query.containsKey("code_challenge"));
            assertFalse(query.containsKey("code_challenge_method"));
            assertEquals("", payload[2]);
        }
    }
}
