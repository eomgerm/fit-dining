package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.*;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthApplicationFlowTests extends PostgresTestSupport {
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();
    final JsonMapper mapper = JsonMapper.builder().build();

    @Test @org.junit.jupiter.api.DisplayName("회원가입_정상 요청과 중복_201 쿠키 발급 및 409 타입 반환")
    void signup_validAndDuplicateAccount_returnsSessionAndConflict() throws Exception {
        String body = """
                {"email":" Signup@Example.com ","password":"password123","nickname":"가입테스트",
                 "verificationToken":"%s","agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                """.formatted(verifiedToken("signup@example.com"));
        var signup = request("POST", "/signup", body, "http://localhost:3000", null, null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        assertEquals("가입테스트", session.get("nickname").asString());
        assertTrue(session.has("sessionId"));
        assertTrue(session.has("accessExpiresAt"));
        assertTrue(session.has("sessionExpiresAt"));
        String cookie = signup.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("SameSite=Strict"));
        assertTrue(cookie.contains("Path=/api/auth"));
        var profile = request("GET", "/me", null, null, session.get("accessToken").asString(), null);
        assertEquals("signup@example.com", mapper.readTree(profile.body()).get("email").asString());
        var duplicate = request("POST", "/signup", body, "http://localhost:3000", null, null);
        assertEquals(409, duplicate.statusCode());
        assertEquals("urn:fitdining:auth:email-taken", mapper.readTree(duplicate.body()).get("type").asString());
        var nickname = request("POST", "/signup", body.replace("Signup@Example.com", "other@example.com"), "http://localhost:3000", null, null);
        assertEquals(409, nickname.statusCode());
        assertEquals("urn:fitdining:auth:nickname-taken", mapper.readTree(nickname.body()).get("type").asString());
        String rt = cookie.split(";", 2)[0];
        var logout = request("POST", "/logout", null, "http://localhost:3000", null, rt);
        assertEquals(204, logout.statusCode());
        assertTrue(logout.headers().firstValue("set-cookie").orElseThrow().contains("Max-Age=0"));
        assertEquals(401, request("POST", "/refresh", null, "http://localhost:3000", null, rt).statusCode());
        assertEquals(204, request("POST", "/logout", null, "http://localhost:3000", null, null).statusCode());
        assertEquals(204, request("POST", "/logout", null, "http://localhost:3000", null, "fitdining_rt=invalid").statusCode());
        assertEquals(200, request("POST", "/login", "{\"email\":\"SIGNUP@example.com\",\"password\":\"password123\"}", "http://localhost:3000", null, null).statusCode());
    }
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("place.mock.enabled", () -> "true");
        registry.add("AUTH_DEMO_EMAIL", () -> "demo@example.com");
        registry.add("AUTH_DEMO_NICKNAME", () -> "demo");
        registry.add("AUTH_DEMO_PASSWORD", () -> "example-test-password1");
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
        String body = "{\"email\":\"demo@example.com\",\"password\":\"example-test-password1\"}";
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
        assertEquals(204, request("POST", "/logout", null, "http://localhost:3000", null, again.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0]).statusCode());
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
        // 리뷰 등록은 로그인이 필요하다(리뷰 D-35). Origin 검사(403)가 아니라 인증(401)으로 거절한다.
        assertEquals(401, response.statusCode());
    }

}
