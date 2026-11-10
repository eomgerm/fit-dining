package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static kr.co.fitdining.api.support.SessionTestSupport.csrf;
import java.time.Clock;
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

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
@WebMvcTest(controllers = {AuthController.class, SessionLoginHttpTests.Probe.class}, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@Import({SecurityConfiguration.class, LegacyRefreshCookieExpiry.class, SessionLoginHttpTests.Config.class, SessionLoginHttpTests.Probe.class})
class SessionLoginHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    static class Config { @Bean Clock clock() { return Clock.systemUTC(); } }
    @RestController static class Probe {
        @PostMapping("/api/test-private") String write() { return "ok"; }
        @RequestMapping(path = "/api/auth/probe-write", method = {RequestMethod.POST, RequestMethod.PUT,
            RequestMethod.PATCH, RequestMethod.DELETE}) String originProbe() { return "ok"; }
    }
    @Autowired MockMvc mvc;
    @MockitoBean AuthUseCases auth;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean
    kr.co.fitdining.api.auth.infrastructure.SessionLogin sessions;
    @Autowired tools.jackson.databind.json.JsonMapper mapper;
    private MockHttpSession login(MockHttpSession previous) throws Exception {
        var identity = new AuthUseCases.Identity("session-user", "nickname", Clock.systemUTC().instant().getEpochSecond() + 86400);
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued(identity));
        var request = post("/api/auth/login").with(csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content("{\"email\":\"a@example.com\",\"password\":\"password1\"}");
        if (previous != null) request.session(previous);
        var result = mvc.perform(request).andExpect(status().isOk())
            .andExpect(jsonPath("$.accessToken").doesNotExist()).andExpect(jsonPath("$.sessionId").doesNotExist())
            .andExpect(jsonPath("$.accessExpiresAt").doesNotExist()).andExpect(cookie().doesNotExist("fitdining_rt")).andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }
    @Test void loginReplacesAllSessionStateAndIgnoresAuthorization() throws Exception {
        var old = new MockHttpSession();
        old.setAttribute("untrusted", "old-state");
        var session = login(old);
        assertThat(old.isInvalid()).isTrue();
        assertThat(session.getId()).isNotEqualTo(old.getId());
        assertThat(session.getAttribute("untrusted")).isNull();
        when(auth.me("session-user")).thenReturn(new AuthUseCases.Profile("nickname", "a@example.com"));
        for (String header : java.util.List.of("Bearer expired", "Basic ignored", "garbage")) {
            mvc.perform(get("/api/auth/me").session(session).header("Authorization", header))
                .andExpect(status().isOk()).andExpect(jsonPath("$.userId").value("session-user"));
        }
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer valid")).andExpect(status().isUnauthorized());
    }
    @Test void csrfCookieDoesNotCreateSessionAndUnknownApiIsClosed() throws Exception {
        var result = mvc.perform(get("/api/auth/csrf")).andExpect(status().isNoContent())
            .andExpect(cookie().exists("XSRF-TOKEN")).andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
        result = mvc.perform(get("/api/new-private-api")).andExpect(status().isUnauthorized()).andReturn();
        assertThat(result.getRequest().getSession(false)).isNull();
    }
    @Test void allWritesRequireCsrfEvenWithAuthorization() throws Exception {
        var session = login(null);
        mvc.perform(post("/api/test-private").session(session)).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/places/1/reviews").session(session)).andExpect(status().isForbidden());
        mvc.perform(post("/api/test-private").header("Authorization", "Bearer valid")).andExpect(status().isForbidden());
        var token = mvc.perform(get("/api/auth/csrf")).andReturn().getResponse().getCookie("XSRF-TOKEN");
        mvc.perform(post("/api/test-private").session(session).cookie(token).header("X-XSRF-TOKEN", token.getValue()))
            .andExpect(status().isOk());
        for (String path : java.util.List.of("/api/auth/login", "/api/auth/signup", "/api/auth/email-verifications",
                "/api/v1/places/search", "/api/v1/onboarding/taste-analysis", "/api/v1/places/1/reviews")) {
            mvc.perform(post(path).header("Origin", "http://localhost:3000")).andExpect(status().isForbidden());
        }
    }
    @Test void logoutRequiresCsrfAndExpiresLegacyCookie() throws Exception {
        var session = login(null);
        mvc.perform(post("/api/auth/logout").session(session).header("Origin", "http://localhost:3000"))
            .andExpect(status().isForbidden());
        assertThat(session.isInvalid()).isFalse();
        mvc.perform(post("/api/auth/logout").with(csrf()).session(session).header("Origin", "http://localhost:3000"))
            .andExpect(status().isNoContent()).andExpect(cookie().maxAge("fitdining_rt", 0));
        assertThat(session.isInvalid()).isTrue();
        verify(auth).logout("session-user");
    }
    @Test void anonymousLogoutDoesNotRecordAnAudit() throws Exception {
        mvc.perform(post("/api/auth/logout").with(csrf()).header("Origin", "http://localhost:3000"))
            .andExpect(status().isNoContent());
        verifyNoInteractions(auth);
    }
    @Test
    void failedSuccessAuditKeepsEmailLoginAndSessionSuccessful(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        String sensitive = "audit-secret-email@example.com audit-secret-password audit-private-session-id";
        doThrow(new org.springframework.dao.DataAccessResourceFailureException(sensitive))
            .when(auth).sessionEstablished("session-user");
        var session = login(null);
        assertThat(session.isInvalid()).isFalse();
        when(auth.me("session-user")).thenReturn(new AuthUseCases.Profile("nickname", "a@example.com"));
        mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isOk())
            .andExpect(jsonPath("$.userId").value("session-user"));
        verify(auth).sessionEstablished("session-user");
        assertThat(output.getAll()).contains("Login success audit failed: reason=DataAccessResourceFailureException")
            .doesNotContain("audit-secret-email@example.com", "audit-secret-password", "audit-private-session-id");
        String warning = output.getAll().lines().filter(line -> line.contains("Login success audit failed")).findFirst().orElseThrow();
        // MockHttpSession IDs are small integers, which can also occur in the log timestamp.
        assertThat(warning.substring(warning.indexOf("Login success audit failed"))).doesNotContain(session.getId());
    }
    @Test void failedSessionCreationDoesNotRecordSuccess() throws Exception {
        var identity = new AuthUseCases.Identity("session-user", "name", 2000000000);
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued(identity));
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("session unavailable"))
            .when(sessions).establish(any(), any(), any());
        mvc.perform(post("/api/auth/login").with(csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content("{\"email\":\"demo@example.com\",\"password\":\"password1\"}"))
            .andExpect(status().isServiceUnavailable());
        verify(auth, never()).sessionEstablished(any());
    }
    @Test void filterAndControllerUnauthorizedProblemsAreIdentical() throws Exception {
        var filter = mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized()).andReturn().getResponse();
        var session = login(null);
        when(auth.me("session-user")).thenThrow(new kr.co.fitdining.api.auth.domain.AuthFailure("invalid"));
        var controller = mvc.perform(get("/api/auth/me").session(session)).andExpect(status().isUnauthorized())
            .andReturn().getResponse();
        assertThat(mapper.readTree(filter.getContentAsString())).isEqualTo(mapper.readTree(controller.getContentAsString()));
        for (var response : java.util.List.of(filter, controller)) {
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
            assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
            assertThat(response.getContentType()).startsWith("application/problem+json");
        }
    }
    @Test void originScopeRemainsPostAndDeleteOnExistingPaths() throws Exception {
        var session = login(null);
        mvc.perform(put("/api/auth/probe-write").with(csrf()).session(session)).andExpect(status().isOk());
        mvc.perform(patch("/api/auth/probe-write").with(csrf()).session(session)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/probe-write").with(csrf()).session(session)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/auth/probe-write").with(csrf()).session(session)).andExpect(status().isForbidden());
    }
    @Test void refreshAndProtectedMappingsAreRemoved() throws Exception {
        var session = login(null);
        mvc.perform(post("/api/auth/refresh").with(csrf()).header("Origin", "http://localhost:3000")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/protected").session(session)).andExpect(status().isNotFound());
    }
}
