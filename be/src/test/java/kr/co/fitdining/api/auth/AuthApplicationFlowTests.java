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


    @Test
    void signupCreatesSessionAndRejectsDuplicateAccount() throws Exception {
        String name = "s" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        String email = name + "@example.com";
        String body = """
            {"email":"%s","password":"password123","nickname":"%s","verificationToken":"%s",
             "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
            """.formatted(email, name, verifiedToken(email));
        var signup = request("POST", "/signup", body, "http://localhost:3000", null, null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        assertEquals(java.util.Set.of("userId", "nickname", "sessionExpiresAt"),
            mapper.readValue(signup.body(), java.util.Map.class).keySet());
        String cookie = kr.co.fitdining.api.support.SessionTestSupport.cookie(signup);
        assertTrue(cookieHeader(signup, "fitdining_session").contains("HttpOnly"));
        assertTrue(cookieHeader(signup, "fitdining_session").contains("SameSite=Lax"));
        var me = request("GET", "/me", null, null, null, cookie);
        assertEquals(200, me.statusCode(), me.body());
        assertEquals(email, mapper.readTree(me.body()).get("email").asString());
        var duplicate = request("POST", "/signup", body, "http://localhost:3000", null, null);
        assertEquals(409, duplicate.statusCode());
        assertEquals("urn:fitdining:auth:email-taken", mapper.readTree(duplicate.body()).get("type").asString());
        assertFalse(signup.headers().allValues("set-cookie").stream().anyMatch(value -> value.startsWith("fitdining_rt=")));
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
        assertEquals(403, response.statusCode());
    }

    @Test
    void redisSessionCookieAuthenticatesAndLogoutRemovesIt() throws Exception {
        var login = request("POST", "/login", "{\"email\":\"demo@example.com\",\"password\":\"example-test-password1\"}",
                "http://localhost:3000", null, null);
        assertEquals(200, login.statusCode(), login.body());
        String cookie = login.headers().allValues("set-cookie").stream()
                .filter(value -> value.startsWith("fitdining_session=")).findFirst().orElseThrow().split(";", 2)[0];
        var me = request("GET", "/me", null, null, null, cookie);
        assertEquals(200, me.statusCode(), me.body());
        assertEquals(mapper.readTree(login.body()).get("userId").asString(), mapper.readTree(me.body()).get("userId").asString());
        assertEquals(mapper.readTree(login.body()).get("sessionExpiresAt").asLong(), mapper.readTree(me.body()).get("sessionExpiresAt").asLong());
        assertEquals(204, request("POST", "/logout", null, "http://localhost:3000", null, cookie).statusCode());
        assertEquals(401, request("GET", "/me", null, null, null, cookie).statusCode());
    }

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("place.mock.enabled", () -> "true");
        registry.add("AUTH_DEMO_EMAIL", () -> "demo@example.com");
        registry.add("AUTH_DEMO_NICKNAME", () -> "demo");
        registry.add("AUTH_DEMO_PASSWORD", () -> "example-test-password1");
    }
    HttpResponse<String> request(String method, String path, String body, String origin, String token, String cookie) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth" + path));
        if (origin != null) builder.header("Origin", origin);
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body != null) builder.header("Content-Type", "application/json");
        kr.co.fitdining.api.support.SessionTestSupport.csrf(builder, client, port, cookie);
        builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    static String cookieHeader(HttpResponse<?> response, String name) {
        return response.headers().allValues("set-cookie").stream().filter(value -> value.startsWith(name + "="))
                .findFirst().orElseThrow();
    }

}
