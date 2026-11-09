package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Clock;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.presentation.*;
import kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.*;

@WebMvcTest(controllers = {AuthController.class, SessionLoginHttpTests.Probe.class}, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@Import({SecurityConfiguration.class, AuthRefreshCookieWriter.class, SessionLoginHttpTests.Config.class, SessionLoginHttpTests.Probe.class})
class SessionLoginHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    static class Config { @Bean AdvancingClock clock() { return new AdvancingClock(); } }
    static class AdvancingClock extends Clock {
        long offset;
        @Override public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public java.time.Instant instant() { return java.time.Instant.now().plusMillis(offset); }
    }
    @RestController static class Probe {
        @PostMapping("/api/test-private") String write() { return "ok"; }
        @RequestMapping(path = "/api/auth/probe-write", method = {RequestMethod.POST, RequestMethod.PUT,
            RequestMethod.PATCH, RequestMethod.DELETE}) String originProbe() { return "ok"; }
    }
    @Autowired MockMvc mvc;
    @Autowired AdvancingClock clock;
    @Autowired tools.jackson.databind.json.JsonMapper mapper;
    @MockitoBean AuthUseCases auth;
    private AuthUseCases.Identity identity(String id) {
        long now = Clock.systemUTC().instant().getEpochSecond();
        return new AuthUseCases.Identity(id, "nickname", "family", now + 1800, now + 86400);
    }
    private MockHttpSession login(MockHttpSession previous) throws Exception {
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued("at", "rt", identity("session-user")));
        var request = post("/api/auth/login").header("Origin", "http://localhost:3000")
            .contentType("application/json").content("{\"email\":\"a@example.com\",\"password\":\"password1\"}");
        if (previous != null) request.session(previous);
        var result = mvc.perform(request).andExpect(status().isOk()).andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }
    @Test void loginReplacesAllSessionStateAndMeUsesSession() throws Exception {
        var old = new MockHttpSession() {
            @Override public long getCreationTime() { return System.currentTimeMillis() - 3600000; }
        };
        long oldCreated = old.getCreationTime();
        long beforeLogin = System.currentTimeMillis();
        old.setAttribute("untrusted", "old-user-state");
        String id = old.getId();
        var session = login(old);
        assertThat(old.isInvalid()).isTrue();
        assertThat(session.getId()).isNotEqualTo(id);
        assertThat(session.getCreationTime()).isGreaterThanOrEqualTo(beforeLogin).isGreaterThan(oldCreated);
        assertThat(session.getAttribute("untrusted")).isNull();
        when(auth.me("session-user")).thenReturn(new AuthUseCases.Profile("nickname", "a@example.com"));
        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value("session-user")).andExpect(jsonPath("$.sessionExpiresAt").isNumber());
    }
    @Test void authorizationAlwaysOverridesSessionIncludingExpiredAndMalformed() throws Exception {
        var session = login(null);
        when(auth.authenticate("expired")).thenThrow(AuthFailure.accessExpired());
        mvc.perform(get("/api/auth/me").session(session).header("Authorization", "Bearer expired"))
            .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.type").value(AuthFailure.ACCESS_TOKEN_EXPIRED.toString()));
        mvc.perform(get("/api/auth/me").session(session).header("Authorization", "Basic ignored"))
            .andExpect(status().isUnauthorized())
            .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        var bearer = identity("bearer-user");
        when(auth.authenticate("valid")).thenReturn(bearer);
        when(auth.me("bearer-user")).thenReturn(new AuthUseCases.Profile("bearer", "b@example.com"));
        mvc.perform(get("/api/auth/me").session(session).header("Authorization", "Bearer valid"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.userId").value("bearer-user"))
            .andExpect(jsonPath("$.sessionExpiresAt").value(bearer.sessionExpiresAt()));
        mvc.perform(get("/api/auth/protected").session(session)).andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value("session-user"));
    }
    @Test void csrfCookieDoesNotCreateSessionAndUnknownApiIsClosed() throws Exception {
        var result = mvc.perform(get("/api/auth/csrf")).andExpect(status().isNoContent())
            .andExpect(cookie().exists("XSRF-TOKEN")).andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
        result = mvc.perform(get("/api/new-private-api")).andExpect(status().isUnauthorized())
            .andExpect(content().contentTypeCompatibleWith("application/problem+json")).andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
    }
    @Test void sessionWritesRequireCsrfButBearerWritesDoNot() throws Exception {
        var session = login(null);
        mvc.perform(post("/api/test-private").session(session)).andExpect(status().isForbidden())
            .andExpect(jsonPath("$.detail").value("CSRF 토큰이 없거나 올바르지 않습니다."))
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        var token = mvc.perform(get("/api/auth/csrf").session(session)).andReturn().getResponse().getCookie("XSRF-TOKEN");
        mvc.perform(post("/api/test-private").session(session).cookie(token).header("X-XSRF-TOKEN", token.getValue()))
            .andExpect(status().isOk());
        var bearer = identity("bearer-user");
        when(auth.authenticate("valid")).thenReturn(bearer);
        mvc.perform(post("/api/test-private").header("Authorization", "Bearer valid")).andExpect(status().isOk());
    }
    @Test void logoutInvalidatesSession() throws Exception {
        var session = login(null);
        mvc.perform(post("/api/auth/logout").session(session).header("Origin", "http://localhost:3000"))
            .andExpect(status().isNoContent());
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void filterFailureMatchesMvcProblemDetailAndIncludesSecurityHeaders() throws Exception {
        var filter = mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(header().string("X-Content-Type-Options", "nosniff"))
            .andExpect(content().contentTypeCompatibleWith("application/problem+json")).andReturn().getResponse();
        when(auth.authenticate("valid")).thenReturn(identity("user"));
        when(auth.me("user")).thenThrow(new AuthFailure("invalid"));
        var controller = mvc.perform(get("/api/auth/me").header("Authorization", "Bearer valid"))
            .andExpect(status().isUnauthorized()).andReturn().getResponse();
        assertThat(mapper.readTree(filter.getContentAsString())).isEqualTo(mapper.readTree(controller.getContentAsString()));
    }
    @Test void originChecksOnlyPostAndDeleteWithinExistingPaths() throws Exception {
        when(auth.authenticate("valid")).thenReturn(identity("user"));
        mvc.perform(put("/api/auth/probe-write").header("Authorization", "Bearer valid"))
            .andExpect(status().isOk());
        mvc.perform(patch("/api/auth/probe-write").header("Authorization", "Bearer valid"))
            .andExpect(status().isOk());
        for (var request : java.util.List.of(post("/api/auth/probe-write"), delete("/api/auth/probe-write"))) {
            mvc.perform(request.header("Authorization", "Bearer valid"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value("허용되지 않은 요청 출처입니다."))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        }
    }
    @Test void installedAbsoluteExpiryFilterRejectsSessionAtTwentyFourHours() throws Exception {
        var session = login(null);
        long expiresAt = (Long) session.getAttribute("auth.expiresAt");
        try {
            clock.offset = expiresAt - System.currentTimeMillis() - 1000;
            mvc.perform(get("/api/auth/protected").session(session)).andExpect(status().isOk());
            clock.offset = expiresAt - System.currentTimeMillis();
            mvc.perform(get("/api/auth/protected").session(session)).andExpect(status().isUnauthorized());
            assertThat(session.isInvalid()).isTrue();
        } finally { clock.offset = 0; }
    }

}
