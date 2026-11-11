package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.persistence.EntityManagerFactory;
import java.sql.DriverManager;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import kr.co.fitdining.api.ApiApplication;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.auth.application.AuthCleanup;
import kr.co.fitdining.api.auth.application.AuthTransactions;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.ports.TokenCodec;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(AuthServiceTests.Configuration.class)
class AuthServiceTests extends PostgresTestSupport {
    @Autowired AuthUseCases auth;
    @Autowired TokenCodec codec;
    @Autowired MutableClock clock;
    @Autowired CheckingHasher passwords;
    @Autowired AuthTransactions transactions;
    @Autowired AuthCleanup cleanup;
    @Autowired AuthUserRepository users;
    @Autowired EntityManagerFactory entityManagerFactory;
    @Autowired org.springframework.core.env.Environment environment;
    JdbcTemplate jdbc;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) throws Exception {
        registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true");
        registry.add("auth.cleanup.batch-size", () -> "2");
    }

    @BeforeEach void setup() {
        clock.instant = Instant.parse("2026-10-23T00:00:00Z");
        passwords.entered = null;
        passwords.release = null;
        jdbc = new JdbcTemplate(appSource());
        for (String table : List.of("taste_input_logs", "auth_security_events", "auth_login_attempts", "auth_social_accounts", "auth_users", "auth_email_verifications")) {
            jdbc.update("delete from " + table);
        }
        users.saveAndFlush(new AuthUser("user-1", "demo@example.com", "demo", passwords.hash("example-test-password1"), clock.instant(), "2026-10-23"));
    }

    String token(String email) { return verifiedToken(email, clock.instant()); }

    AuthUseCases.Issued login() { return auth.login("demo@example.com", "example-test-password1", "ip"); }
    void unauthorized(org.junit.jupiter.api.function.Executable work) {
        assertEquals(401, assertThrows(AuthFailure.class, work).status());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"login", "signup"})
    @DisplayName("시도 제한_신뢰 프록시의 서로 다른 사용자_주소별로 독립 집계")
    void attempts_trustedProxy_countsEachForwardedClientSeparately(String action) throws Exception {
        String first = NativeForwardedHeadersTests.resolve("172.18.0.5", "203.0.113.10", "https", 8080).address();
        String second = NativeForwardedHeadersTests.resolve("172.18.0.5", "203.0.113.11", "https", 8080).address();
        int rejected = action.equals("login") ? 401 : 409;
        for (int i = 0; i < 20; i++) assertEquals(rejected, attempt(action, first));
        assertEquals(429, attempt(action, first));
        assertEquals(rejected, attempt(action, second));
        assertEquals(20, attemptCount(first, action));
        assertEquals(1, attemptCount(second, action));
        assertEquals(0, attemptCount("172.18.0.5", action));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"login", "signup"})
    @DisplayName("시도 제한_비신뢰 연결의 전달 헤더 위조_연결 주소로 집계")
    void attempts_untrustedPeer_cannotEvadeLimitWithForwardedHeaders(String action) throws Exception {
        int rejected = action.equals("login") ? 401 : 409;
        for (int i = 0; i < 20; i++) {
            String address = NativeForwardedHeadersTests.resolve("198.51.100.7", "203.0.113." + (i + 1), "https", 8080).address();
            assertEquals(rejected, attempt(action, address));
        }
        String address = NativeForwardedHeadersTests.resolve("198.51.100.7", "203.0.113.99", "https", 8080).address();
        assertEquals(429, attempt(action, address));
        assertEquals(20, attemptCount("198.51.100.7", action));
        assertEquals(0, attemptCount("203.0.113.99", action));
    }

    private int attempt(String action, String remoteAddress) throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders
                .standaloneSetup(new kr.co.fitdining.api.auth.presentation.AuthController(auth,
                        new kr.co.fitdining.api.auth.presentation.LegacyRefreshCookieExpiry(false),
                        new kr.co.fitdining.api.auth.infrastructure.SessionLogin(false)))
                .setControllerAdvice(new kr.co.fitdining.api.auth.presentation.AuthExceptionHandler(environment)).build();
        String body = action.equals("login")
                ? "{\"email\":\"demo@example.com\",\"password\":\"wrong\"}"
                : """
                    {"email":"demo@example.com","password":"password1","nickname":"new",
                     "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                    """;
        return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/auth/" + action)
                .header("Origin", "http://localhost:3000").contentType("application/json").content(body)
                .with(request -> { request.setRemoteAddr(remoteAddress); return request; }))
                .andReturn().getResponse().getStatus();
    }

    private int attemptCount(String address, String action) {
        return jdbc.queryForObject("select count(*) from auth_login_attempts where address=? and action=?", Integer.class, address, action);
    }

    @Test @DisplayName("가입_이메일 정규화와 약관 저장_즉시 로그인과 갱신 허용")
    void signup_normalizedAccount_persistsAgreementsAndIssuesSession() {
        var issued = auth.signup(" New@Example.COM ", "password1", " 새이름 ", token("new@example.com"), "signup-ip");
        var user = users.findByEmail("new@example.com").orElseThrow();
        assertEquals("새이름", user.getNickname());
        assertEquals("new@example.com", user.getContactEmail());
        assertEquals(user.getEmailVerifiedAt(), user.getContactEmailVerifiedAt());
        assertNull(user.getMarketingAgreedAt());
        assertEquals(clock.instant(), user.getAgeConfirmedAt());
        assertEquals(clock.instant(), user.getTermsAgreedAt());
        assertEquals(clock.instant(), user.getPrivacyAgreedAt());
        assertEquals("2026-11-02", user.getTermsVersion());
        assertNotEquals("password1", user.getPasswordHash());
        assertEquals("새이름", issued.identity().nickname());
        assertEquals("새이름", auth.login(" NEW@example.com ", "password1", "login-ip").identity().nickname());
        assertEquals(new AuthUseCases.Profile("새이름", "new@example.com"), auth.me(user.getId()));
    }

    @Test @DisplayName("가입_이메일과 닉네임 중복_타입별 409 반환")
    void signup_duplicateFields_returnsDistinctConflictTypes() {
        var email = assertThrows(AuthFailure.class, () -> auth.signup(" DEMO@EXAMPLE.COM ", "password1", "new", null, "ip"));
        assertEquals(409, email.status());
        assertEquals("urn:fitdining:auth:email-taken", email.type().toString());
        var nickname = assertThrows(AuthFailure.class, () -> auth.signup("new@example.com", "password1", " DEMO ", null, "ip"));
        assertEquals(409, nickname.status());
        assertEquals("urn:fitdining:auth:nickname-taken", nickname.type().toString());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"pairσ,pairς", "pairK,pairk"})
    @DisplayName("닉네임_유니코드 대소문자_사전 검사와 DB 유니크 판정 일치")
    void signup_unicodeNickname_matchesDatabaseUniqueConstraint(String first, String second) {
        auth.signup("first@example.com", "password1", first, token("first@example.com"), "first-ip");
        boolean same = jdbc.queryForObject("select lower(?) = lower(?)", Boolean.class, first, second);
        assertEquals(same, users.existsByNickname(second));
        Runnable insert = () -> jdbc.update("insert into auth_users(id,email,nickname,password_hash,created_at,"
                + "age_confirmed_at,terms_agreed_at,privacy_agreed_at,terms_version) "
                + "select 'probe','probe@example.com',?,password_hash,created_at,age_confirmed_at,"
                + "terms_agreed_at,privacy_agreed_at,terms_version from auth_users where email='first@example.com'", second);
        if (same) {
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class, insert::run);
            var failure = assertThrows(AuthFailure.class, () -> auth.signup("second@example.com", "password1", second, token("second@example.com"), "second-ip"));
            assertEquals(409, failure.status());
            assertEquals("urn:fitdining:auth:nickname-taken", failure.type().toString());
        } else {
            assertDoesNotThrow(insert::run);
            jdbc.update("delete from auth_users where id='probe'");
            assertNotNull(auth.signup("second@example.com", "password1", second, token("second@example.com"), "second-ip"));
        }
    }

    @Test @DisplayName("닉네임_켈빈 기호 동시 가입 경합_유니크 위반을 409로 변환")
    void signup_unicodeNicknameRace_returnsConflictInsteadOfUnavailable() throws Exception {
        passwords.hashEntered = new CountDownLatch(2);
        passwords.hashRelease = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Callable<Integer> first = () -> signupStatus("first@example.com", "pairK");
            Callable<Integer> second = () -> signupStatus("second@example.com", "pairk");
            var a = executor.submit(first);
            var b = executor.submit(second);
            try { assertTrue(passwords.hashEntered.await(5, TimeUnit.SECONDS)); }
            finally { passwords.hashRelease.countDown(); }
            boolean same = jdbc.queryForObject("select lower('pairK') = lower('pairk')", Boolean.class);
            var statuses = new java.util.ArrayList<>(List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS)));
            statuses.sort(Integer::compareTo);
            assertEquals(same ? List.of(201, 409) : List.of(201, 201), statuses);
        } finally { passwords.hashEntered = null; passwords.hashRelease = null; }
    }

    private int signupStatus(String email, String nickname) {
        try { auth.signup(email, "password1", nickname, token(email), email); return 201; }
        catch (AuthFailure failure) {
            assertEquals("urn:fitdining:auth:nickname-taken", failure.type().toString());
            return failure.status();
        }
    }

    @Test @DisplayName("가입과 로그인_유니코드 바깥 공백_같은 계정으로 정규화")
    void signup_unicodeWhitespace_normalizesAccountAndLogin() {
        auth.signup("\u00a0\u3000 NEW@Example.com\u3000\u00a0", "password1", "\u00a0\u3000 새이름\u3000\u00a0", token("new@example.com"), "unicode-ip");
        assertEquals("새이름", users.findByEmail("new@example.com").orElseThrow().getNickname());
        assertEquals("새이름", auth.login("\u00a0NEW@example.com\u3000", "password1", "unicode-login").identity().nickname());
    }

    @Test @DisplayName("가입_동시 INSERT 경합_한 요청만 성공하고 개인정보 없이 409")
    @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void signup_concurrentInsert_onlyOneSucceeds(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        // Hash gate ensures both requests passed prechecks before either INSERT starts.
        passwords.hashEntered = new CountDownLatch(2);
        passwords.hashRelease = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Callable<Integer> work = () -> {
                // 서로 다른 토큰으로 같은 이메일을 동시에 가입해 계정 유니크 경합을 만든다.
                String verification = token("race@example.com");
                try { auth.signup("race@example.com", "password1", "race", verification, "race-ip"); return 201; }
                catch (AuthFailure failure) { return failure.status(); }
            };
            var a = executor.submit(work);
            var b = executor.submit(work);
            try { assertTrue(passwords.hashEntered.await(5, TimeUnit.SECONDS)); }
            finally { passwords.hashRelease.countDown(); }
            var results = new java.util.ArrayList<>(List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS)));
            results.sort(Integer::compareTo);
            assertEquals(List.of(201, 409), results);
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_users where email='race@example.com'", Integer.class));
            assertFalse(output.getAll().contains("race@example.com"));
        } finally { passwords.hashEntered = null; passwords.hashRelease = null; }
    }

    @Test @DisplayName("가입_시도 제한_로그인 제한과 독립적으로 429")
    void signup_attemptLimit_isIndependentOfLogin() {
        for (int i = 0; i < 20; i++) assertEquals(409, assertThrows(AuthFailure.class,
                () -> auth.signup("demo@example.com", "password1", "new", null, "ip")).status());
        assertEquals(429, assertThrows(AuthFailure.class,
                () -> auth.signup("new@example.com", "password1", "new", null, "ip")).status());
        assertNotNull(login());
        clock.advance(900);
        assertNotNull(auth.signup("new@example.com", "password1", "new", token("new@example.com"), "ip"));
    }

    @Test @DisplayName("로그인_잘못된 비밀번호 반복_영속 제한 후 시간 경과로 해제")
    void login_invalidCredentials_persistentlyRateLimited() {
        for (int i = 0; i < 20; i++) unauthorized(() -> auth.login("missing", "wrong", "ip"));
        assertEquals(429, assertThrows(AuthFailure.class, this::login).status());
        clock.advance(900);
        assertNotNull(login());
    }

    @Test @DisplayName("마이그레이션_인증 설정 없음_DB 설정만으로 기동 종료")
    void migrate_withoutAuthEnvironment_startsAndCloses() throws Exception {
        // APP_ENV=dev 계약에 맞는 DB를 같은 시험 컨테이너에 준비한다.
        try (var connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                var statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE fit_dev OWNER fit_migrator");
        }
        String migrateUrl = POSTGRES.getJdbcUrl().replace("/" + POSTGRES.getDatabaseName(), "/fit_dev");
        // 확장은 DB마다 관리자가 만든다(infra/data/ensure-databases.sh).
        try (var connection = DriverManager.getConnection(migrateUrl, POSTGRES.getUsername(), POSTGRES.getPassword());
                var statement = connection.createStatement()) {
            statement.execute("CREATE EXTENSION IF NOT EXISTS vector");
        }
        try (var context = new SpringApplicationBuilder(ApiApplication.class).web(WebApplicationType.NONE)
                .profiles("migrate").properties(
                        "auth.jwt-secret=${UNDEFINED_AUTH_KEY}", "auth.frontend-origin=${UNDEFINED_AUTH_ORIGIN}",
                        "auth.cookie-secure=${UNDEFINED_AUTH_SECURE}").run(
                        "--APP_ENV=dev", "--SPRING_PROFILES_ACTIVE=migrate", "--TZ=Asia/Seoul",
                        "--SPRING_DATASOURCE_URL=" + migrateUrl,
                        "--SPRING_DATASOURCE_USERNAME=fit_migrator", "--SPRING_DATASOURCE_PASSWORD=test-migrator")) {
            assertEquals(0, context.getBeansOfType(AuthUseCases.class).size());
            assertEquals(0, context.getBeansOfType(AuthCleanup.class).size());
        }
    }

    @Test @DisplayName("DB 권한_앱 계정 DDL_거부")
    void appRole_schemaChange_denied() {
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.execute("create table forbidden(id int)"));
    }

    @Test
    void loginAndLogoutRecordAuditWithoutCredentials() {
        var issued = login();
        auth.sessionEstablished(issued.identity().userId());
        unauthorized(() -> auth.login("missing@example.com", "wrong", "audit-ip"));
        auth.logout(issued.identity().userId());
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where type='LOGIN_SUCCESS' and user_id='user-1' and family_id is null", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where type='LOGIN_FAILURE' and user_id is null", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where type='LOGOUT' and user_id='user-1'", Integer.class));
        String rows = jdbc.queryForList("select row_to_json(e)::text from auth_security_events e", String.class).toString();
        assertFalse(rows.contains("example.com"));
        assertFalse(rows.contains("example-test-password1"));
        assertEquals(clock.instant().getEpochSecond() + 86400, issued.identity().sessionExpiresAt());
    }

    @Test
    void cleanupPreservesRecentLegacyEvidenceAndDeletesBoundedOldRows() {
        for (int i = 0; i < 3; i++) {
            jdbc.update("insert into auth_security_events(family_id,created_at,type,reuse_count) values ('legacy',?,'REFRESH_REUSE',1)",
                java.sql.Timestamp.from(clock.instant().minusSeconds(91 * 86400)));
            jdbc.update("insert into taste_input_logs(text,succeeded,created_at) values ('old',false,?)",
                java.sql.Timestamp.from(clock.instant().minusSeconds(91 * 86400)));
        }
        jdbc.update("insert into auth_security_events(family_id,created_at,type,reuse_count) values ('recent',?,'ATTACK_DETECTED',3)",
            java.sql.Timestamp.from(clock.instant().minusSeconds(8 * 86400)));
        cleanup.clean();
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where family_id='legacy'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where family_id='recent'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from taste_input_logs where text='old'", Integer.class));
    }

    @Test
    void migrationPreservesLegacyEventsAndRefreshTable() throws Exception {
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                var statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            try {
                statement.execute("create schema migration_audit_test");
                statement.execute("set local search_path to migration_audit_test");
                statement.execute(java.nio.file.Files.readString(java.nio.file.Path.of("src/main/resources/db/migration/V1__auth.sql")));
                statement.execute("insert into auth_users(id,email,nickname,age_confirmed_at,terms_agreed_at,privacy_agreed_at,terms_version,password_hash,created_at) "
                    + "values ('old-user','old@example.com','old',now(),now(),now(),'v','hash',now())");
                statement.execute("insert into auth_refresh_tokens(jti,family_id,user_id,created_at,expires_at) "
                    + "values ('old-jti','old-family','old-user',now(),now()+interval '1 day')");
                statement.execute("insert into auth_security_events(family_id,created_at,type,reuse_count) values ('old-family',now(),'REFRESH_REUSE',2)");
                statement.execute(java.nio.file.Files.readString(java.nio.file.Path.of("src/main/resources/db/migration/V25__session_login_audit.sql")));
                try (var rows = statement.executeQuery("select family_id,type,reuse_count,user_id from auth_security_events")) {
                    assertTrue(rows.next());
                    assertEquals("old-family", rows.getString(1));
                    assertEquals("REFRESH_REUSE", rows.getString(2));
                    assertEquals(2, rows.getInt(3));
                    assertNull(rows.getString(4));
                    assertFalse(rows.next());
                }
                try (var rows = statement.executeQuery("select user_id from auth_refresh_tokens where jti='old-jti'")) {
                    assertTrue(rows.next()); assertEquals("old-user", rows.getString(1));
                }
                statement.execute("insert into auth_security_events(user_id,created_at,type,reuse_count) values (null,now(),'LOGIN_FAILURE',0)");
                try (var rows = statement.executeQuery("select to_regclass('migration_audit_test.auth_refresh_tokens')")) {
                    assertTrue(rows.next()); assertNotNull(rows.getString(1));
                }
            } finally { connection.rollback(); }
        }
    }

    @Test
    void invalidAndRateLimitedLoginsAndAnonymousLogoutDoNotWriteAudit() {
        var invalid = assertThrows(AuthFailure.class, () -> auth.login("", "password1", "audit-format"));
        assertEquals(400, invalid.status());
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        for (int i = 0; i < 20; i++) unauthorized(() -> auth.login("missing@example.com", "wrong", "audit-limit"));
        assertEquals(20, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        for (int i = 0; i < 3; i++) {
            assertEquals(429, assertThrows(AuthFailure.class,
                () -> auth.login("missing@example.com", "wrong", "audit-limit")).status());
            auth.logout(null);
        }
        assertEquals(20, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
    }

    @Test
    void issuingIdentityDoesNotRecordSuccessBeforeSessionEstablishment() {
        var issued = login();
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        auth.sessionEstablished(issued.identity().userId());
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where type='LOGIN_SUCCESS'", Integer.class));
    }

    @Test
    void demoReseedPreservesExistingPasswordHash() {
        String original = users.findById("user-1").orElseThrow().getPasswordHash();
        transactions.seedUser("demo@example.com", "replacement", passwords.hash("another-password1"));
        assertEquals(original, users.findById("user-1").orElseThrow().getPasswordHash());
        assertNotNull(login());
    }

    @TestConfiguration
    static class Configuration {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
        @Bean @Primary CheckingHasher testPasswords() { return new CheckingHasher(); }
    }
    static final class MutableClock extends Clock {
        volatile Instant instant = Instant.parse("2026-10-23T00:00:00Z");
        void advance(long seconds) { instant = instant.plusSeconds(seconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return instant; }
    }
    static final class CheckingHasher implements PasswordHasher {
        final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
        volatile CountDownLatch entered;
        volatile CountDownLatch release;
        volatile CountDownLatch hashEntered;
        volatile CountDownLatch hashRelease;
        @Override public String hash(String password) {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            if (hashEntered != null) {
                hashEntered.countDown();
                try { assertTrue(hashRelease.await(8, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            }
            return encoder.encode(password);
        }
        @Override public boolean matches(String password, String hash) {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            if (entered != null) {
                entered.countDown();
                try { assertTrue(release.await(8, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            }
            return encoder.matches(password, hash);
        }
    }
}
