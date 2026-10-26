package kr.co.fitdining.api.user;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.*;
import java.util.UUID;
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
        return new JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(POSTGRES.getJdbcUrl(), "fit_migrator", "test-migrator"));
    }
    String id() { return UUID.randomUUID().toString().substring(0, 10); }
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
                "tastes":[{"polarity":"LIKE","label":"  국물  "}]}
                """), null);
        assertEquals(201, response.statusCode(), response.body());
        var session = mapper.readTree(response.body());
        String user = session.get("userId").asString(), token = session.get("accessToken").asString();
        var claims = mapper.readTree(new String(java.util.Base64.getUrlDecoder().decode(token.split("\\.")[1]), java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(user, claims.get("sub").asString());
        var read = request("GET", "/api/v1/users/" + user + "/preferences", null, token);
        assertEquals(200, read.statusCode(), read.body());
        assertEquals(1, mapper.readTree(read.body()).get("priorities").size());
        assertEquals("국물", mapper.readTree(read.body()).get("tastes").get(0).get("label").asString());
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
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
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
}
