package kr.co.fitdining.api;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import kr.co.fitdining.api.auth.PostgresTestSupport;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiApplicationTests extends PostgresTestSupport {
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();
    final JsonMapper mapper = JsonMapper.builder().build();
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) throws Exception {
        migrate();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "fit_dev_app");
        registry.add("spring.datasource.password", () -> "test-app");
        registry.add("JWT_SECRET", () -> Base64.getEncoder().encodeToString(new byte[32]));
        registry.add("AUTH_FRONTEND_ORIGIN", () -> "http://localhost:3000");
        registry.add("AUTH_COOKIE_SECURE", () -> "false");
        registry.add("place.mock.enabled", () -> "true");
        registry.add("review.mock.enabled", () -> "true");
        registry.add("AUTH_DEMO_USERNAME", () -> "demo");
        registry.add("AUTH_DEMO_PASSWORD", () -> "example-test-password");
    }
    HttpResponse<String> request(String method, String path, String body, String origin, String token, String cookie) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth" + path));
        if (origin != null) builder.header("Origin", origin);
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (cookie != null) builder.header("Cookie", cookie);
        if (body != null) builder.header("Content-Type", "application/json");
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test @org.junit.jupiter.api.DisplayName("인증_쿠키 회전과 재사용_RT 폐기 후 AT 유지") void auth_cookieRotationAndReplay_revokesRefreshButKeepsAccess() throws Exception {
        String body = "{\"username\":\"demo\",\"password\":\"example-test-password\"}";
        assertEquals(403, request("POST", "/login", body, null, null, null).statusCode());
        assertEquals(403, request("POST", "/login", body, "https://untrusted.example", null, null).statusCode());
        var missing = request("GET", "/me", null, null, null, null);
        assertEquals(401, missing.statusCode());
        assertTrue(missing.headers().firstValue("content-type").orElseThrow().contains("application/problem+json"));
        assertFalse(mapper.readTree(missing.body()).has("code"));
        assertTrue(mapper.readTree(missing.body()).has("detail"));
        var login = request("POST", "/login", body, "http://localhost:3000", null, null);
        assertEquals(200, login.statusCode(), login.body());
        String at = mapper.readTree(login.body()).get("accessToken").asString();
        String setCookie = login.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(setCookie.contains("HttpOnly")); assertTrue(setCookie.contains("SameSite=Strict"));
        assertTrue(setCookie.contains("Path=/api/auth"));
        assertEquals("no-store", login.headers().firstValue("cache-control").orElseThrow());
        String rtCookie = setCookie.split(";", 2)[0];
        assertEquals(200, request("GET", "/me", null, null, at, null).statusCode());
        var refresh = request("POST", "/refresh", null, "http://localhost:3000", null, rtCookie);
        assertEquals(200, refresh.statusCode(), refresh.body());
        String newAt = mapper.readTree(refresh.body()).get("accessToken").asString();
        var replay = request("POST", "/refresh", null, "http://localhost:3000", null, rtCookie);
        assertEquals(401, replay.statusCode());
        assertTrue(replay.headers().firstValue("set-cookie").orElseThrow().contains("Max-Age=0"));
        assertEquals(200, request("GET", "/protected", null, null, newAt, null).statusCode());
        var again = request("POST", "/login", body, "http://localhost:3000", null, null);
        String freshAt = mapper.readTree(again.body()).get("accessToken").asString();
        assertEquals(204, request("POST", "/logout", null, "http://localhost:3000", freshAt, null).statusCode());
        assertEquals(200, request("GET", "/me", null, null, freshAt, null).statusCode());
    }
    @Test @org.junit.jupiter.api.DisplayName("공개 API_인증 활성화_토큰 없이 장소 리뷰 처리")
    void publicApis_authEnabled_workWithoutTokenOrOrigin() throws Exception {
        for (String path : new String[]{"/api/v1/places/suggest?q=cafe", "/api/v1/places/1/reviews"}) {
            var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode(), response.body());
            assertFalse(response.headers().firstValue("cache-control").orElse("").contains("no-store"));
        }
        var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/places/1/reviews"))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{}")) .build(), HttpResponse.BodyHandlers.ofString());
        assertNotEquals(401, response.statusCode());
        assertNotEquals(403, response.statusCode());
        assertNotEquals(405, response.statusCode());
    }

}
