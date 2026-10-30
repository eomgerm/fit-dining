package kr.co.fitdining.api.user;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.util.UUID;
import java.util.List;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PreferencesFlowTests extends PostgresTestSupport {
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();
    final JsonMapper mapper = JsonMapper.builder().build();
    final JdbcTemplate jdbc = new JdbcTemplate(appSource());
    String signupBody(String id, String preferences) {
        return "{\"email\":\"" + id + "@example.com\",\"password\":\"password123\",\"nickname\":\"" + id
                + "\",\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}" + preferences + "}";
    }
    JdbcTemplate migrationJdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), "fit_migrator", "test-migrator"));
    }
    String id() { return UUID.randomUUID().toString().substring(0, 10); }
    @Test
    void profile_emailOwnershipAndWithdrawal() throws Exception {
        String name = id();
        var signup = request("POST", "/api/auth/signup", signupBody(name, ""), null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        String user = session.get("userId").asString(), token = session.get("accessToken").asString();
        String path = "/api/v1/users/" + user;
        var read = request("GET", path, null, token);
        assertEquals(200, read.statusCode(), read.body());
        var profile = mapper.readTree(read.body());
        assertEquals(user, profile.get("userId").asString());
        assertEquals(name, profile.get("nickname").asString());
        assertEquals("email", profile.get("loginMethod").asString());
        assertEquals(3, profile.size());
        assertEquals(401, request("GET", path, null, null).statusCode());
        assertEquals(403, request("GET", "/api/v1/users/other", null, token).statusCode());
        assertEquals(204, request("DELETE", path, null, token).statusCode());
        assertEquals(404, request("GET", path, null, token).statusCode());
    }
    @ParameterizedTest @ValueSource(strings = {"google", "kakao", "naver"})
    void profile_socialProvider(String provider) throws Exception {
        var signup = request("POST", "/api/auth/signup", signupBody(id(), ""), null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        String user = session.get("userId").asString();
        jdbc.update("insert into auth_social_accounts(provider, provider_user_id, user_id, created_at) values (?, ?, ?, now())",
                provider, id(), user);
        var read = request("GET", "/api/v1/users/" + user, null, session.get("accessToken").asString());
        assertEquals(200, read.statusCode(), read.body());
        assertEquals(provider, mapper.readTree(read.body()).get("loginMethod").asString());
    }
    HttpResponse<String> request(String method, String path, String body, String token) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Origin", "http://localhost:3000");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body != null) builder.header("Content-Type", "application/json");
        return client.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
    }
    @Test @DisplayName("취향_가입과 조회_중복 제거 및 본인 인증")
    void preferences_signupAndRead_deduplicatesAndChecksOwner() throws Exception {
        var response = request("POST", "/api/auth/signup", signupBody(id(), """
                ,"preferences":{"mood":"QUIET","priorities":["SPACIOUS","SPACIOUS"],"purposes":["SOLO"],
                "tastes":[{"polarity":"LIKE","label":"  국물  ","code":"FOOD_SPICY"}]}
                """), null);
        assertEquals(201, response.statusCode(), response.body());
        var session = mapper.readTree(response.body());
        String user = session.get("userId").asString(), token = session.get("accessToken").asString();
        var claims = mapper.readTree(new String(Base64.getUrlDecoder().decode(token.split("\\.")[1]), StandardCharsets.UTF_8));
        assertEquals(user, claims.get("sub").asString());
        var read = request("GET", "/api/v1/users/" + user + "/preferences", null, token);
        assertEquals(200, read.statusCode(), read.body());
        assertEquals(1, mapper.readTree(read.body()).get("priorities").size());
        assertEquals("국물", mapper.readTree(read.body()).get("tastes").get(0).get("label").asString());
        assertEquals("FOOD_SPICY", mapper.readTree(read.body()).get("tastes").get(0).get("code").asString());
        assertEquals("[]", jdbc.queryForObject("select features::text from user_preferences where user_id=?", String.class, user));
        assertEquals(401, request("GET", "/api/v1/users/" + user + "/preferences", null, null).statusCode());
        assertEquals(403, request("GET", "/api/v1/users/other/preferences", null, token).statusCode());
    }
    @Test @DisplayName("취향_생략_행 없이 가입")
    void preferences_omitted_createsNoRow() throws Exception {
        var response = request("POST", "/api/auth/signup", signupBody(id(), ""), null);
        assertEquals(201, response.statusCode(), response.body());
        var session = mapper.readTree(response.body());
        assertEquals(404, request("GET", "/api/v1/users/" + session.get("userId").asString() + "/preferences", null,
                session.get("accessToken").asString()).statusCode());
    }
    @ParameterizedTest
    @ValueSource(strings = {
        "{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"x\",\"code\":\"bad-code\"}]}",
        "{\"mood\":\"UNKNOWN\"}", "{\"priorities\":[\"UNKNOWN\"]}",
        "{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"   \"}]}"})
    @DisplayName("취향_잘못된 코드와 라벨_필드 오류와 가입 방지")
    void preferences_invalid_returnsFieldErrorsWithoutAccount(String preferences) throws Exception {
        String id = id();
        var response = request("POST", "/api/auth/signup", signupBody(id, ",\"preferences\":" + preferences), null);
        assertEquals(400, response.statusCode(), response.body());
        assertTrue(mapper.readTree(response.body()).get("errors").get(0).get("field").asString().startsWith("preferences."));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_users where email = ?", Integer.class, id + "@example.com"));
    }
    @Test @DisplayName("취향_저장 실패_계정 생성도 롤백")
    void preferences_storageFailure_rollsBackSignup() throws Exception {
        String id = id();
        try {
            migrationJdbc().execute("ALTER TABLE user_preferences ADD CONSTRAINT test_reject_preferences CHECK (mood <> 'LIVELY')");
            var response = request("POST", "/api/auth/signup", signupBody(id, ",\"preferences\":{\"mood\":\"LIVELY\"}"), null);
            assertEquals(503, response.statusCode());
            assertEquals(0, jdbc.queryForObject("select count(*) from auth_users where email = ?", Integer.class, id + "@example.com"));
        } finally { migrationJdbc().execute("ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS test_reject_preferences"); }
    }

    @Test @DisplayName("탈퇴_반복과 재가입_취향 삭제와 모든 RT 폐기 및 새 id")
    void withdraw_repeatedAndSignupAgain_deletesPreferencesAndRevokesAllSessions() throws Exception {
        String name = id(), body = signupBody(name, ",\"preferences\":{\"mood\":\"QUIET\"}");
        var signup = request("POST", "/api/auth/signup", body, null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        String user = session.get("userId").asString(), at = session.get("accessToken").asString();
        String rt = signup.headers().firstValue("set-cookie").orElseThrow().split(";", 2)[0];
        String credentials = "{\"email\":\"" + name + "@example.com\",\"password\":\"password123\"}";
        assertEquals(200, request("POST", "/api/auth/login", credentials, null).statusCode());
        assertEquals(403, request("DELETE", "/api/v1/users/other", null, at).statusCode());
        var wrongOrigin = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/users/" + user))
                .header("Origin", "https://other.example").header("Authorization", "Bearer " + at).DELETE().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, wrongOrigin.statusCode());
        var withdrawn = request("DELETE", "/api/v1/users/" + user, null, at);
        assertEquals(204, withdrawn.statusCode(), withdrawn.body());
        String cookie = withdrawn.headers().firstValue("set-cookie").orElseThrow();
        assertTrue(cookie.contains("Max-Age=0") && cookie.contains("Path=/api/auth") && cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"));
        assertNotNull(jdbc.queryForObject("select deleted_at from auth_users where id = ?", Timestamp.class, user));
        assertEquals(0, jdbc.queryForObject("select count(*) from user_preferences where user_id = ?", Integer.class, user));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where user_id = ? and revoked_at is null", Integer.class, user));
        assertEquals(204, request("DELETE", "/api/v1/users/" + user, null, at).statusCode());
        assertEquals(404, request("GET", "/api/v1/users/" + user + "/preferences", null, at).statusCode());
        assertEquals(401, request("POST", "/api/auth/login", credentials, null).statusCode());
        var refresh = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/refresh"))
                .header("Origin", "http://localhost:3000").header("Cookie", rt).POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(401, refresh.statusCode());
        var again = request("POST", "/api/auth/signup", body, null);
        assertEquals(201, again.statusCode(), again.body());
        assertNotEquals(user, mapper.readTree(again.body()).get("userId").asString());
        assertEquals(409, request("POST", "/api/auth/signup", body, null).statusCode());
    }
    @Test @DisplayName("스키마_V2 적용_배열 JSONB 및 활성 계정 부분 유일 인덱스")
    void schema_v2_preservesPlannedNativeTypesAndIndexes() {
        assertEquals("ARRAY", jdbc.queryForObject("select data_type from information_schema.columns where table_name='user_preferences' and column_name='priorities'", String.class));
        assertEquals("jsonb", jdbc.queryForObject("select data_type from information_schema.columns where table_name='user_preferences' and column_name='tastes'", String.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from pg_constraint where conname='auth_users_email_key'", Integer.class));
        for (String index : List.of("auth_users_email_active_idx", "auth_users_nickname_active_idx")) {
            assertTrue(jdbc.queryForObject("select indexdef from pg_indexes where indexname=?", String.class, index).contains("WHERE (deleted_at IS NULL)"));
        }
    }

    @ParameterizedTest @ValueSource(strings = {"GET", "DELETE"})
    @DisplayName("사용자 API_인코딩 경로와 AT 없음_401")
    void userApi_encodedPathWithoutToken_returns401(String method) throws Exception {
        String suffix = method.equals("GET") ? "/preferences" : "";
        var response = request(method, "/api/v1/%75sers/test-user" + suffix, null, null);
        assertEquals(401, response.statusCode(), response.body());
        assertEquals("인증을 확인해주세요.", mapper.readTree(response.body()).get("detail").asString());
    }
    @Test @DisplayName("사용자 API_출처와 소유자 불일치_별도 고정 문구")
    void userApi_wrongOriginAndOwner_returnsDistinctDetails() throws Exception {
        var signup = request("POST", "/api/auth/signup", signupBody(id(), ""), null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        String user = session.get("userId").asString(), token = session.get("accessToken").asString();
        var origin = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/users/" + user))
                .header("Authorization", "Bearer " + token).DELETE().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(403, origin.statusCode());
        assertEquals("허용되지 않은 요청 출처입니다.", mapper.readTree(origin.body()).get("detail").asString());
        var owner = request("GET", "/api/v1/users/other/preferences", null, token);
        assertEquals(403, owner.statusCode());
        assertEquals("접근 권한이 없습니다.", mapper.readTree(owner.body()).get("detail").asString());
    }
    @ParameterizedTest @ValueSource(strings = {"en-US", "ko-KR", "fr-FR"})
    @DisplayName("취향 검증_여러 로캘과 잘못된 라벨_고정 1자 이상 문구")
    void preferences_invalidLabels_returnsLocaleIndependentReasons(String locale) throws Exception {
        for (String label : List.of("", "a".repeat(21))) {
            String body = signupBody(id(), ",\"preferences\":{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"" + label + "\"}]}");
            var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/signup"))
                    .header("Origin", "http://localhost:3000").header("Accept-Language", locale)
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(400, response.statusCode(), response.body());
            var errors = mapper.readTree(response.body()).get("errors");
            assertFalse(errors.isEmpty());
            for (var error : errors) {
                assertEquals("preferences.tastes[0].label", error.get("field").asString());
                assertEquals("취향은 1~20자로 입력해 주세요.", error.get("reason").asString());
            }
        }
    }

    @ParameterizedTest @ValueSource(strings = {"LOGOUT", "REFRESH_REUSE"})
    @DisplayName("탈퇴_이미 폐기된 RT 존재_기존 사유와 시각 유지 및 활성 RT 폐기")
    void withdraw_previouslyRevokedToken_preservesHistoryAndRevokesActiveTokens(String reason) throws Exception {
        String name = id();
        var signup = request("POST", "/api/auth/signup", signupBody(name, ""), null);
        assertEquals(201, signup.statusCode(), signup.body());
        var session = mapper.readTree(signup.body());
        String user = session.get("userId").asString(), family = session.get("sessionId").asString();
        String at = session.get("accessToken").asString();
        jdbc.update("update auth_refresh_tokens set revoked_at = created_at, revoke_reason = ? where family_id = ?", reason, family);
        var previous = jdbc.queryForMap("select revoked_at, revoke_reason from auth_refresh_tokens where family_id = ?", family);
        String credentials = "{\"email\":\"" + name + "@example.com\",\"password\":\"password123\"}";
        var login = request("POST", "/api/auth/login", credentials, null);
        assertEquals(200, login.statusCode(), login.body());
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_refresh_tokens where user_id = ? and revoked_at is null", Integer.class, user));
        assertEquals(204, request("DELETE", "/api/v1/users/" + user, null, at).statusCode());
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where user_id = ? and revoked_at is null", Integer.class, user));
        assertEquals(previous, jdbc.queryForMap("select revoked_at, revoke_reason from auth_refresh_tokens where family_id = ?", family));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_refresh_tokens where user_id = ? and revoke_reason = 'WITHDRAWN'", Integer.class, user));
        assertEquals(204, request("DELETE", "/api/v1/users/" + user, null, at).statusCode());
        assertEquals(previous, jdbc.queryForMap("select revoked_at, revoke_reason from auth_refresh_tokens where family_id = ?", family));
    }
}
