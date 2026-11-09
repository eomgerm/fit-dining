package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.net.URI;
import java.net.http.*;
import java.util.UUID;
import kr.co.fitdining.api.auth.infrastructure.SocialProviderClient;
import kr.co.fitdining.api.auth.infrastructure.SocialTokens;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;

/** Real HTTP, PostgreSQL and Redis; only the external OAuth provider is replaced. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.hikari.maximum-pool-size=2", "place.mock.enabled=true",
    "AUTH_GOOGLE_CLIENT_ID=session-test", "AUTH_GOOGLE_CLIENT_SECRET=session-secret"})
@org.springframework.context.annotation.Import(SessionAuthenticationFlowTests.ErrorProbe.class)
class SessionAuthenticationFlowTests extends PostgresTestSupport {
    @org.springframework.web.bind.annotation.RestController
    static class ErrorProbe {
        @org.springframework.web.bind.annotation.GetMapping("/api/v1/places/probe-error")
        String error() { throw new IllegalStateException("test failure"); }
    }
    @Value("${local.server.port}") int port;
    @Autowired SocialTokens socialTokens;
    @MockitoBean SocialProviderClient provider;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean java.time.Clock clock;
    // The shared database retains rate-limit counters from other HTTP suites.
    final String address = "198.18." + java.util.concurrent.ThreadLocalRandom.current().nextInt(256)
            + "." + java.util.concurrent.ThreadLocalRandom.current().nextInt(1, 255);
    final HttpClient client = HttpClient.newHttpClient();
    final JsonMapper mapper = JsonMapper.builder().build();

    HttpResponse<String> request(String method, String path, String body, String cookies, String csrf) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Origin", "http://localhost:3000").header("X-Forwarded-For", address);
        if (cookies != null) builder.header("Cookie", cookies);
        if (csrf != null) builder.header("X-XSRF-TOKEN", csrf);
        if (body != null) builder.header("Content-Type", "application/json");
        return client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    static String cookie(HttpResponse<?> response, String name) {
        return response.headers().allValues("set-cookie").stream().filter(value -> value.startsWith(name + "="))
                .findFirst().orElseThrow().split(";", 2)[0];
    }
    String newName() { return "s" + UUID.randomUUID().toString().replace("-", "").substring(0, 10); }
    HttpResponse<String> signup(String name) throws Exception {
        String body = """
            {"email":"%s@example.com","password":"password123","nickname":"%s","verificationToken":"%s",
             "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
            """.formatted(name, name, verifiedToken(name + "@example.com"));
        var result = request("POST", "/api/auth/signup", body, null, null);
        assertEquals(201, result.statusCode(), result.body());
        return result;
    }
    void assertSessionMe(HttpResponse<String> result, String userId) throws Exception {
        var me = request("GET", "/api/auth/me", null, cookie(result, "fitdining_session"), null);
        assertEquals(200, me.statusCode(), me.body());
        assertEquals(userId, mapper.readTree(me.body()).get("userId").asString());
    }
    @Test void signupIssuesRedisSession() throws Exception {
        var result = signup(newName());
        assertSessionMe(result, mapper.readTree(result.body()).get("userId").asString());
    }
    @Test void existingSocialCallbackIssuesRedisSession() throws Exception {
        var account = signup(newName());
        String userId = mapper.readTree(account.body()).get("userId").asString();
        String subject = UUID.randomUUID().toString();
        new JdbcTemplate(appSource()).update(
                "insert into auth_social_accounts(provider, provider_user_id, user_id, created_at) values ('google', ?, ?, now())",
                subject, userId);
        when(provider.exchange(any(), any(), any(), any(), any())).thenReturn(subject);
        String state = socialTokens.encode("oauth_state", "google", "state", "verifier", "login");
        var callback = request("GET", "/api/auth/oauth/google/callback?code=code&state=state", null,
                "fitdining_oauth=" + state, null);
        assertEquals(302, callback.statusCode(), callback.body());
        assertEquals("/", callback.headers().firstValue("location").orElseThrow());
        assertSessionMe(callback, userId);
    }
    @Test void socialSignupIssuesRedisSession() throws Exception {
        String token = socialTokens.encode("social_signup", "google", UUID.randomUUID().toString());
        var result = request("POST", "/api/auth/social/signup",
                "{\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}", "fitdining_social=" + token, null);
        assertEquals(201, result.statusCode(), result.body());
        assertSessionMe(result, mapper.readTree(result.body()).get("userId").asString());
    }
    @Test void logoutRevokesBothSessionAndRefreshToken() throws Exception {
        var result = signup(newName());
        String session = cookie(result, "fitdining_session"), refresh = cookie(result, "fitdining_rt");
        assertEquals(204, request("POST", "/api/auth/logout", null, session + "; " + refresh, null).statusCode());
        assertEquals(401, request("GET", "/api/auth/me", null, session, null).statusCode());
        assertEquals(401, request("POST", "/api/auth/refresh", null, refresh, null).statusCode());
    }
    @Test void withdrawalRevokesEveryRedisSessionForThatUser() throws Exception {
        String name = newName();
        var first = signup(name);
        String userId = mapper.readTree(first.body()).get("userId").asString();
        var second = request("POST", "/api/auth/login",
                "{\"email\":\"" + name + "@example.com\",\"password\":\"password123\"}", null, null);
        assertEquals(200, second.statusCode(), second.body());
        String firstSession = cookie(first, "fitdining_session"), secondSession = cookie(second, "fitdining_session");
        assertNotEquals(firstSession, secondSession);
        assertSessionMe(first, userId);
        assertSessionMe(second, userId);
        var csrf = request("GET", "/api/auth/csrf", null, firstSession, null);
        String csrfCookie = cookie(csrf, "XSRF-TOKEN");
        var withdrawal = request("DELETE", "/api/v1/users/" + userId, null, firstSession + "; " + csrfCookie,
                csrfCookie.substring("XSRF-TOKEN=".length()));
        assertEquals(204, withdrawal.statusCode(), withdrawal.body());
        assertEquals(401, request("GET", "/api/auth/me", null, firstSession, null).statusCode());
        assertEquals(401, request("GET", "/api/auth/me", null, secondSession, null).statusCode());
        assertEquals(401, request("GET", "/api/auth/protected", null, secondSession, null).statusCode());
    }
    @Test void anonymousPublicGetAndPostNeverIssueSessionCookies() throws Exception {
        String[] gets = {"/api/v1/places/suggest?q=cafe", "/api/v1/places/1", "/api/v1/places/ids", "/api/v1/places/1/reviews"};
        for (String path : gets) assertAnonymous(request("GET", path, null, null, null));
        assertAnonymous(request("POST", "/api/v1/places/search", "{\"query\":\"cafe\"}", null, null));
        assertAnonymous(request("POST", "/api/v1/onboarding/taste-analysis", "{\"text\":\"empty\"}", null, null));
    }
    void assertAnonymous(HttpResponse<String> result) {
        assertEquals(200, result.statusCode(), result.body());
        assertTrue(result.headers().allValues("set-cookie").stream().noneMatch(value -> value.startsWith("fitdining_session=")));
    }
    @Test void errorDispatchPreservesOriginalStatus() throws Exception {
        assertEquals(400, request("GET", "/api/v1/places/not-a-number", null, null, null).statusCode());
        assertEquals(404, request("GET", "/actuator/not-exposed", null, null, null).statusCode());
        assertEquals(500, request("GET", "/api/v1/places/probe-error", null, null, null).statusCode());
    }

    @Test void absoluteExpiryRejectsRedisSessionAtTheHttpBoundary() throws Exception {
        var result = signup(newName());
        String session = cookie(result, "fitdining_session");
        long expiry = mapper.readTree(result.body()).get("sessionExpiresAt").asLong() * 1000L;
        try {
            doReturn(expiry - 1).when(clock).millis();
            assertEquals(200, request("GET", "/api/auth/protected", null, session, null).statusCode());
            doReturn(expiry).when(clock).millis();
            assertEquals(401, request("GET", "/api/auth/protected", null, session, null).statusCode());
            assertEquals(401, request("GET", "/api/auth/me", null, session, null).statusCode());
        } finally { doCallRealMethod().when(clock).millis(); }
    }

}
