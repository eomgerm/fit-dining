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
    LegacyRefreshCookieExpiry.class, kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration.class, SocialHttpTests.Configuration.class
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
    @MockitoBean EmailVerifications verifications;
    @MockitoBean AuthTransactions transactions;
    @MockitoSpyBean SessionLogin sessions;

    @BeforeEach
    void allow() {
        when(transactions.recordAttempt(any(), any())).thenReturn(true);
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void kakaoAuthorizationRequestsEmailOnlyWhenEnabled(boolean enabled) throws Exception {
        var env = new MockEnvironment().withProperty("AUTH_KAKAO_CLIENT_ID", "id")
                .withProperty("AUTH_KAKAO_CLIENT_SECRET", "secret")
                .withProperty("AUTH_KAKAO_EMAIL_SCOPE_ENABLED", Boolean.toString(enabled));
        doReturn(new SocialProviders(env).get("kakao")).when(providers).get("kakao");
        String location = mvc.perform(get("/api/auth/oauth/kakao")).andExpect(status().isFound())
                .andReturn().getResponse().getHeader("Location");
        var query = UriComponentsBuilder.fromUriString(location).build().getQueryParams();
        assertEquals(enabled ? "account_email" : null, query.getFirst("scope"));
    }

    @Test
    void missingOrInvalidStateCookieDoesNotWriteFailureAudit() throws Exception {
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state"))
            .andExpect(status().isFound());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", "invalid"))).andExpect(status().isFound());
        verify(transactions, never()).recordAttempt(any(), any());
        verify(transactions, never()).audit(any(), any());
    }
    @Test
    void rateLimitedCallbackDoesNotWriteFailureAudit() throws Exception {
        when(transactions.recordAttempt(any(), any())).thenReturn(false);
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound());
        verify(transactions, never()).audit(any(), any());
    }
    @Test
    void failedSessionCreationRecordsOnlyFailureAfterBoundedCallback() throws Exception {
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile("subject", "provider@example.com"));
        when(accounts.existing(any(), any())).thenReturn(issued());
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("session unavailable"))
            .when(sessions).establish(any(), any(), any());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/login?error=social"));
        verify(transactions).audit(null, "LOGIN_FAILURE");
        verify(transactions, never()).audit(any(), eq("LOGIN_SUCCESS"));
    }
    @Test
    void successAuditFollowsSessionCreation() throws Exception {
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile("subject", "provider@example.com"));
        when(accounts.existing(any(), any())).thenReturn(issued());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/"));
        var order = inOrder(sessions, transactions);
        order.verify(sessions).establish(any(), any(), any());
        order.verify(transactions).audit("id", "LOGIN_SUCCESS");
        verify(transactions, never()).audit(any(), eq("LOGIN_FAILURE"));
    }

    @Test
    void failedSuccessAuditKeepsSocialCallbackAndSessionSuccessful(CapturedOutput output) throws Exception {
        String sensitive = "audit-secret-email@example.com audit-secret-password audit-private-session-id";
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile("subject", "provider@example.com"));
        when(accounts.existing(any(), any())).thenReturn(issued());
        doThrow(new org.springframework.dao.DataAccessResourceFailureException(sensitive))
            .when(transactions).audit("id", "LOGIN_SUCCESS");
        var result = mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/")).andReturn();
        var session = (org.springframework.mock.web.MockHttpSession) result.getRequest().getSession(false);
        assertNotNull(session);
        assertFalse(session.isInvalid());
        when(auth.me("id")).thenReturn(new AuthUseCases.Profile("nickname", "a@example.com"));
        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value("id"));
        verify(transactions).audit("id", "LOGIN_SUCCESS");
        verify(transactions, never()).audit(any(), eq("LOGIN_FAILURE"));
        assertTrue(output.getAll().contains("Login success audit failed: reason=DataAccessResourceFailureException"));
        for (String secret : new String[]{"audit-secret-email@example.com", "audit-secret-password", "audit-private-session-id"})
            assertFalse(output.getAll().contains(secret));
        String warning = output.getAll().lines().filter(line -> line.contains("Login success audit failed")).findFirst().orElseThrow();
        assertFalse(warning.substring(warning.indexOf("Login success audit failed")).contains(session.getId()));
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
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile("subject", "provider@example.com"));
        var result = mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "signup"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/signup/social"))
            .andExpect(cookie().httpOnly("fitdining_social", true)).andExpect(cookie().path("fitdining_social", "/api/auth/social"))
            .andReturn();
        var cookie = result.getResponse().getCookie("fitdining_social");
        assertEquals("Strict", cookie.getAttribute("SameSite"));
        assertEquals(600, cookie.getMaxAge());
        assertArrayEquals(new String[]{"google", "subject", "provider@example.com"},
                tokens.decode(cookie.getValue(), "social_signup", 3));
    }

    AuthUseCases.Issued issued() {
        long now = Clock.systemUTC().instant().getEpochSecond();
        return new AuthUseCases.Issued(new AuthUseCases.Identity("id", "nickname", now + 86400));
    }

    @Test
    @DisplayName("콜백_기존 사용자_RT 발급 후 데모 이동")
    void callback_existingIdentity_issuesRefresh() throws Exception {
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile("subject", "provider@example.com"));
        when(accounts.existing(any(), any())).thenReturn(issued());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
            .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
            .andExpect(status().isFound()).andExpect(header().string("Location", "/")).andExpect(cookie().doesNotExist("fitdining_rt"));
    }

    String body = "{\"nickname\":\"새닉네임\",\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}";
    @Test
    @DisplayName("소셜가입_정상 요청_201 토큰과 쿠키 삭제")
    void signup_valid_issuesTokens() throws Exception {
        when(accounts.signup(any(), any(), any(), any(), any(), anyBoolean())).thenReturn(issued());
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000").contentType("application/json").content(body.replace("\"nickname\":\"새닉네임\",", ""))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject", "provider@example.com"))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.userId").value("id")).andExpect(jsonPath("$.accessToken").doesNotExist()).andExpect(cookie().maxAge("fitdining_social", 0));
    }

    @Test
    @DisplayName("소셜가입_쿠키 없음_401")
    void signup_missingCookie_rejects() throws Exception {
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000").contentType("application/json").content(body)).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("소셜가입_다른 출처_403")
    void signup_untrustedOrigin_rejects() throws Exception {
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://evil.example").contentType("application/json").content(body)).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("소셜가입_기존 닉네임 입력은 무시")
    void signup_legacyNickname_isIgnored() throws Exception {
        when(accounts.signup(any(), any(), any(), any(), any(), anyBoolean())).thenReturn(issued());
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content(body.replace("새닉네임", "a"))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject", "provider@example.com"))))
            .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("소셜가입_약관 미동의_400 약관 오류")
    void signup_unacceptedTerms_returnsAgreementError() throws Exception {
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content(body.replace("\"terms\":true", "\"terms\":false"))
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject", "provider@example.com"))))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors.length()").value(1))
            .andExpect(jsonPath("$.errors[0].field").value("agreements.terms"));
    }

    @Test
    @DisplayName("소셜가입_시도 제한_429")
    void signup_limited_returnsRetryAfter() throws Exception {
        when(transactions.recordAttempt(any(), any())).thenReturn(false);
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000").contentType("application/json").content(body)
            .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", "subject", "provider@example.com"))))
            .andExpect(status().isTooManyRequests()).andExpect(header().string("Retry-After", "900"));
    }

    @ParameterizedTest @ValueSource(strings = {
        "tampered", "expired"
    })
    @DisplayName("소셜가입_위조와 만료 쿠키_401")
    void signup_invalidCookie_rejects(String scenario) throws Exception {
        String token = tokens.encode("social_signup", "google", "subject", "provider@example.com");
        if (scenario.equals("tampered")) token += "x";
        else {
            Clock old = Clock.offset(Clock.systemUTC(), Duration.ofMinutes(-11));
            token = new SocialTokens(new NimbusTokenCodec(new byte[32], old), old).encode("social_signup", "google", "subject", "provider@example.com");
        }

        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000").contentType("application/json").content(body)
            .cookie(new Cookie("fitdining_social", token))).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("프로필_소셜 사용자_이메일 필드 생략")
    void me_socialUser_omitsEmail() throws Exception {
        when(auth.me(any())).thenReturn(new AuthUseCases.Profile("social", null));
        mvc.perform(get("/api/auth/me").with(kr.co.fitdining.api.support.SessionTestSupport.session("id"))).andExpect(status().isOk()).andExpect(jsonPath("$.email").doesNotExist());
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
