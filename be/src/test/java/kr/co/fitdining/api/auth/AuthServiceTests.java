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
        for (String table : List.of("auth_refresh_tokens", "auth_security_events", "auth_login_attempts", "auth_social_accounts", "auth_users")) {
            jdbc.update("delete from " + table);
        }
        users.saveAndFlush(new AuthUser("user-1", "demo@example.com", "demo", passwords.hash("example-test-password1"), clock.instant(), "2026-10-23"));
    }

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
                        new kr.co.fitdining.api.auth.presentation.AuthRefreshCookieWriter(false, clock)))
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
        var issued = auth.signup(" New@Example.COM ", "password1", " 새이름 ", "signup-ip");
        var user = users.findByEmail("new@example.com").orElseThrow();
        assertEquals("새이름", user.getNickname());
        assertEquals(clock.instant(), user.getAgeConfirmedAt());
        assertEquals(clock.instant(), user.getTermsAgreedAt());
        assertEquals(clock.instant(), user.getPrivacyAgreedAt());
        assertEquals("2026-10-23", user.getTermsVersion());
        assertNotEquals("password1", user.getPasswordHash());
        assertEquals("새이름", issued.identity().nickname());
        assertEquals("새이름", auth.refresh(issued.refreshToken()).identity().nickname());
        assertEquals("새이름", auth.login(" NEW@example.com ", "password1", "login-ip").identity().nickname());
        assertEquals(new AuthUseCases.Profile("새이름", "new@example.com"), auth.me(user.getId()));
    }

    @Test @DisplayName("가입_이메일과 닉네임 중복_타입별 409 반환")
    void signup_duplicateFields_returnsDistinctConflictTypes() {
        var email = assertThrows(AuthFailure.class, () -> auth.signup(" DEMO@EXAMPLE.COM ", "password1", "new", "ip"));
        assertEquals(409, email.status());
        assertEquals("urn:fitdining:auth:email-taken", email.type().toString());
        var nickname = assertThrows(AuthFailure.class, () -> auth.signup("new@example.com", "password1", " DEMO ", "ip"));
        assertEquals(409, nickname.status());
        assertEquals("urn:fitdining:auth:nickname-taken", nickname.type().toString());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"pairσ,pairς", "pairK,pairk"})
    @DisplayName("닉네임_유니코드 대소문자_사전 검사와 DB 유니크 판정 일치")
    void signup_unicodeNickname_matchesDatabaseUniqueConstraint(String first, String second) {
        auth.signup("first@example.com", "password1", first, "first-ip");
        boolean same = jdbc.queryForObject("select lower(?) = lower(?)", Boolean.class, first, second);
        assertEquals(same, users.existsByNickname(second));
        Runnable insert = () -> jdbc.update("insert into auth_users(id,email,nickname,password_hash,created_at,"
                + "age_confirmed_at,terms_agreed_at,privacy_agreed_at,terms_version) "
                + "select 'probe','probe@example.com',?,password_hash,created_at,age_confirmed_at,"
                + "terms_agreed_at,privacy_agreed_at,terms_version from auth_users where email='first@example.com'", second);
        if (same) {
            assertThrows(org.springframework.dao.DataIntegrityViolationException.class, insert::run);
            var failure = assertThrows(AuthFailure.class, () -> auth.signup("second@example.com", "password1", second, "second-ip"));
            assertEquals(409, failure.status());
            assertEquals("urn:fitdining:auth:nickname-taken", failure.type().toString());
        } else {
            assertDoesNotThrow(insert::run);
            jdbc.update("delete from auth_users where id='probe'");
            assertNotNull(auth.signup("second@example.com", "password1", second, "second-ip"));
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
        try { auth.signup(email, "password1", nickname, email); return 201; }
        catch (AuthFailure failure) {
            assertEquals("urn:fitdining:auth:nickname-taken", failure.type().toString());
            return failure.status();
        }
    }

    @Test @DisplayName("가입과 로그인_유니코드 바깥 공백_같은 계정으로 정규화")
    void signup_unicodeWhitespace_normalizesAccountAndLogin() {
        auth.signup("\u00a0\u3000 NEW@Example.com\u3000\u00a0", "password1", "\u00a0\u3000 새이름\u3000\u00a0", "unicode-ip");
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
                try { auth.signup("race@example.com", "password1", "race", "race-ip"); return 201; }
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
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_refresh_tokens", Integer.class));
            assertFalse(output.getAll().contains("race@example.com"));
        } finally { passwords.hashEntered = null; passwords.hashRelease = null; }
    }

    @Test @DisplayName("가입_시도 제한_로그인 제한과 독립적으로 429")
    void signup_attemptLimit_isIndependentOfLogin() {
        for (int i = 0; i < 20; i++) assertEquals(409, assertThrows(AuthFailure.class,
                () -> auth.signup("demo@example.com", "password1", "new", "ip")).status());
        assertEquals(429, assertThrows(AuthFailure.class,
                () -> auth.signup("new@example.com", "password1", "new", "ip")).status());
        assertNotNull(login());
        clock.advance(900);
        assertNotNull(auth.signup("new@example.com", "password1", "new", "ip"));
    }

    @Test @DisplayName("JWT_최소 페이로드_AT와 RT에 허용된 키만 포함")
    void tokens_minimalPayload_containsOnlySpecifiedClaims() throws Exception {
        var issued = login();
        assertEquals(java.util.Set.of("iss", "aud", "sub", "iat", "exp", "token_type"),
                com.nimbusds.jwt.SignedJWT.parse(issued.accessToken()).getJWTClaimsSet().getClaims().keySet());
        assertEquals(java.util.Set.of("iss", "aud", "sub", "jti", "iat", "exp", "token_type"),
                com.nimbusds.jwt.SignedJWT.parse(issued.refreshToken()).getJWTClaimsSet().getClaims().keySet());
    }

    @Test @DisplayName("로그아웃_RT 없음과 잘못된 용도_멱등 처리하고 유효 세션 보존")
    void logout_invalidCookie_isIdempotentWithoutRevokingOtherFamily() {
        var issued = login();
        assertDoesNotThrow(() -> auth.logout(null));
        assertDoesNotThrow(() -> auth.logout("invalid"));
        assertDoesNotThrow(() -> auth.logout(issued.accessToken()));
        assertNotNull(auth.refresh(issued.refreshToken()));
    }

    @Test @DisplayName("로그아웃_두 묶음 중 하나 폐기_RT만 차단하고 AT 유지")
    void logout_twoFamilies_revokesRefreshButKeepsAccessUntilExpiry() {
        var first = login();
        var second = login();
        auth.logout(first.refreshToken());
        unauthorized(() -> auth.refresh(first.refreshToken()));
        assertEquals("user-1", auth.authenticate(first.accessToken()).userId());
        assertNotNull(auth.refresh(second.refreshToken()));
        clock.advance(1800);
        assertEquals(AuthFailure.ACCESS_TOKEN_EXPIRED,
                assertThrows(AuthFailure.class, () -> auth.authenticate(first.accessToken())).type());
    }

    @Test @DisplayName("갱신_세 번 재사용_묶음 폐기와 공격 기록 후 AT 유지")
    void refresh_threeReplays_revokesFamilyAndRecordsAttackButKeepsAccess() {
        var first = login();
        var next = auth.refresh(first.refreshToken());
        assertEquals(first.identity().sessionId(), next.identity().sessionId());
        assertNotEquals(first.refreshToken(), next.refreshToken());
        for (int i = 0; i < 3; i++) unauthorized(() -> auth.refresh(first.refreshToken()));
        assertEquals(3, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        assertEquals("ATTACK_DETECTED", jdbc.queryForObject("select type from auth_security_events order by id desc limit 1", String.class));
        assertNotNull(auth.authenticate(next.accessToken()));
        unauthorized(() -> auth.refresh(next.refreshToken()));
    }

    @Test @DisplayName("갱신_AT 만료 후 반복 갱신_묶음 절대 만료 유지")
    void refresh_repeatedRotation_preservesAbsoluteExpiry() {
        var first = login();
        clock.advance(1800);
        unauthorized(() -> auth.authenticate(first.accessToken()));
        var next = auth.refresh(first.refreshToken());
        clock.advance(86400 - 1800 - 10);
        var last = auth.refresh(next.refreshToken());
        assertEquals(first.identity().sessionExpiresAt(), last.identity().accessExpiresAt());
        clock.advance(10);
        unauthorized(() -> auth.refresh(last.refreshToken()));
        unauthorized(() -> auth.authenticate(last.accessToken()));
    }

    @Test @DisplayName("토큰_잘못된 용도와 미등록 RT_거부하고 무상태 AT 허용")
    void authenticate_statelessAccess_acceptsSignedClaimsWithoutDatabaseRecord() {
        var first = login();
        unauthorized(() -> auth.authenticate(first.refreshToken()));
        unauthorized(() -> auth.refresh(first.accessToken()));
        long now = clock.instant().getEpochSecond();
        String at = codec.encode(new TokenCodec.Token("user-1", null, "access", now, now + 100));
        assertNotNull(auth.authenticate(at));
        String rt = codec.encode(new TokenCodec.Token("user-1", "unknown", "refresh", now, now + 1000));
        unauthorized(() -> auth.refresh(rt));
    }

    @Test @DisplayName("갱신_동일 RT 동시 요청_한 번만 성공")
    void refresh_concurrentTransactions_onlyOneSucceeds() throws Exception {
        var first = login();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var gate = new CountDownLatch(1);
            Callable<Boolean> work = () -> {
                gate.await();
                try { auth.refresh(first.refreshToken()); return true; }
                catch (AuthFailure e) { assertEquals(401, e.status()); return false; }
            };
            var a = executor.submit(work);
            var b = executor.submit(work);
            gate.countDown();
            assertNotEquals(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertNotNull(auth.authenticate(first.accessToken()));
        }
    }

    @Test @DisplayName("폐기_서로 다른 옛 RT 동시 재사용_교착 없이 이벤트 두 건 기록")
    void refresh_differentOldTokensConcurrently_recordsBothReplaysWithoutDeadlock() throws Exception {
        var first = login();
        var second = auth.refresh(first.refreshToken());
        auth.refresh(second.refreshToken());
        runConcurrentRevokers(first.identity().sessionId(),
                () -> unauthorized(() -> auth.refresh(first.refreshToken())),
                () -> unauthorized(() -> auth.refresh(second.refreshToken())));
        assertEquals(2, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        assertEquals(List.of(1, 2), jdbc.queryForList("select reuse_count from auth_security_events order by reuse_count", Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where revoked_at is null", Integer.class));
    }

    @Test @DisplayName("폐기_로그아웃과 재사용 동시 요청_교착 없이 폐기와 이벤트 완료")
    void logout_concurrentReplay_completesWithoutDeadlockOrLostEvent() throws Exception {
        var first = login();
        var current = auth.refresh(first.refreshToken());
        runConcurrentRevokers(first.identity().sessionId(),
                () -> auth.logout(current.refreshToken()),
                () -> unauthorized(() -> auth.refresh(first.refreshToken())));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where revoked_at is null", Integer.class));
    }

    @Test @DisplayName("폐기 사유_로그아웃 후 옛 RT 재사용_최초 사유와 시각 보존")
    void refresh_replayAfterLogout_preservesOriginalRevocationReasonAndTime() {
        var first = login();
        var current = auth.refresh(first.refreshToken());
        auth.logout(current.refreshToken());
        var revoked = jdbc.queryForList("select jti,revoked_at,revoke_reason from auth_refresh_tokens order by jti");
        clock.advance(10);
        for (int i = 0; i < 3; i++) unauthorized(() -> auth.refresh(first.refreshToken()));
        assertEquals(revoked, jdbc.queryForList("select jti,revoked_at,revoke_reason from auth_refresh_tokens order by jti"));
        assertEquals(2, jdbc.queryForObject("select count(*) from auth_refresh_tokens where revoke_reason='LOGOUT'", Integer.class));
        assertEquals(3, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
    }

    /** Holds the family lock until both callers wait on it, then verifies they hold no RT row locks. */
    private void runConcurrentRevokers(String family, Runnable first, Runnable second) throws Exception {
        try (var connection = appSource().getConnection(); var executor = Executors.newFixedThreadPool(2)) {
            connection.setAutoCommit(false);
            try (var lock = connection.prepareStatement("select 1 from pg_advisory_xact_lock(hashtext(?))")) {
                lock.setString(1, family);
                lock.execute();
            }
            var gate = new CountDownLatch(1);
            var a = executor.submit(() -> { gate.await(); first.run(); return null; });
            var b = executor.submit(() -> { gate.await(); second.run(); return null; });
            gate.countDown();
            try {
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
                int waiting = 0;
                while (System.nanoTime() < deadline) {
                    waiting = jdbc.queryForObject("select count(*) from pg_stat_activity where datname=current_database() and usename=current_user and wait_event='advisory'", Integer.class);
                    if (waiting == 2) break;
                    Thread.sleep(20);
                }
                assertEquals(2, waiting, "Both revokers must acquire the family lock before RT row locks");
                try (var rows = connection.prepareStatement("select jti from auth_refresh_tokens where family_id=? order by jti for update nowait")) {
                    rows.setString(1, family);
                    rows.execute();
                }
            } finally {
                connection.rollback();
            }
            a.get(10, TimeUnit.SECONDS);
            b.get(10, TimeUnit.SECONDS);
        }
    }

    @Test @DisplayName("로그인_느린 비밀번호 검사_트랜잭션 없이 다른 묶음 갱신 허용")
    void login_slowBcrypt_doesNotBlockOtherRefresh() throws Exception {
        users.saveAndFlush(new AuthUser("user-2", "other@example.com", "other", passwords.hash("example-test-password1"), clock.instant(), "2026-10-23"));
        var first = auth.login("other@example.com", "example-test-password1", "other-ip");
        passwords.entered = new CountDownLatch(1);
        passwords.release = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var loggingIn = executor.submit(this::login);
            try {
                assertTrue(passwords.entered.await(5, TimeUnit.SECONDS));
                assertNotNull(executor.submit(() -> auth.refresh(first.refreshToken())).get(3, TimeUnit.SECONDS));
            } finally {
                passwords.release.countDown();
            }
            assertNotNull(loggingIn.get(5, TimeUnit.SECONDS));
        }
    }

    @Test @DisplayName("인증과 갱신_이력 수천 행 추가_SQL 수 일정하며 인증은 영 건")
    void authenticate_andRefresh_largeHistory_keepsFixedSqlCount() {
        var first = login();
        var statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        auth.authenticate(first.accessToken());
        assertEquals(0, statistics.getPrepareStatementCount());
        statistics.clear();
        auth.refresh(first.refreshToken());
        long small = statistics.getPrepareStatementCount();
        assertTrue(small > 0 && small <= 6, "SQL count=" + small);
        jdbc.execute("insert into auth_refresh_tokens(jti,family_id,user_id,created_at,expires_at) "
                + "select 'bulk-'||g,'bulk-family-'||g,'user-1',now(),now()+interval '1 day' from generate_series(1,3000) g");
        var second = login();
        statistics.clear();
        auth.authenticate(second.accessToken());
        assertEquals(0, statistics.getPrepareStatementCount());
        statistics.clear();
        auth.refresh(second.refreshToken());
        assertEquals(small, statistics.getPrepareStatementCount());
    }

    @Test @DisplayName("로그인_잘못된 비밀번호 반복_영속 제한 후 시간 경과로 해제")
    void login_invalidCredentials_persistentlyRateLimited() {
        for (int i = 0; i < 20; i++) unauthorized(() -> auth.login("missing", "wrong", "ip"));
        assertEquals(429, assertThrows(AuthFailure.class, this::login).status());
        clock.advance(900);
        assertNotNull(login());
    }

    @Test @DisplayName("정리_보관 기간과 상한_오래된 행만 삭제하고 증거 유지")
    void cleanup_expiredRows_deletesBoundedBatchAndPreservesEvidence() {
        var first = login();
        jdbc.update("update auth_refresh_tokens set created_at=?,expires_at=?", java.sql.Timestamp.from(clock.instant().minusSeconds(10*86400)), java.sql.Timestamp.from(clock.instant().minusSeconds(8*86400)));
        jdbc.update("insert into auth_security_events(family_id,created_at,type,reuse_count) values (?,?,?,?)",
                first.identity().sessionId(), java.sql.Timestamp.from(clock.instant().minusSeconds(8*86400)), "REFRESH_REUSE", 1);
        for (int i = 0; i < 3; i++) {
            jdbc.update("insert into auth_security_events(family_id,created_at,type,reuse_count) values (?,?,?,?)",
                    "old", java.sql.Timestamp.from(clock.instant().minusSeconds(91*86400)), "REFRESH_REUSE", 1);
            jdbc.update("insert into auth_login_attempts(address,action,created_at) values (?,'login',?)", "old", java.sql.Timestamp.from(clock.instant().minusSeconds(901)));
        }
        jdbc.update("insert into auth_login_attempts(address,action,created_at) values (?,'login',?)", "boundary", java.sql.Timestamp.from(clock.instant().minusSeconds(900)));
        cleanup.clean();
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where family_id=?", Integer.class, first.identity().sessionId()));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where family_id='old'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_login_attempts where address='old'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_login_attempts where address='boundary'", Integer.class));
    }

    @Test @DisplayName("저장_발급과 시드 재실행_RT만 저장하고 비밀번호 유지")
    void persistence_issueAndReseed_neverStoresRawCredentialsOrOverwritesPassword() {
        var first = login();
        String oldHash = users.findById("user-1").orElseThrow().getPasswordHash();
        transactions.seedUser("demo@example.com", "demo", passwords.hash("another-test-password"));
        assertEquals(oldHash, users.findById("user-1").orElseThrow().getPasswordHash());
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_refresh_tokens", Integer.class));
        for (String table : List.of("auth_users", "auth_refresh_tokens", "auth_security_events", "auth_login_attempts")) {
            String rows = jdbc.queryForList("select row_to_json(t)::text from " + table + " t", String.class).toString();
            assertFalse(rows.contains(first.accessToken()));
            assertFalse(rows.contains(first.refreshToken()));
            assertFalse(rows.contains("example-test-password"));
        }
    }

    @Test @DisplayName("토큰_변조와 잘못된 서명 클레임_인증 거부")
    void authenticate_invalidSignatureOrClaims_rejected() throws Exception {
        var first = login();
        var parsed = com.nimbusds.jwt.SignedJWT.parse(first.accessToken());
        for (String field : List.of("iss", "aud", "iat")) {
            var builder = new com.nimbusds.jwt.JWTClaimsSet.Builder(parsed.getJWTClaimsSet());
            if (field.equals("iss")) builder.issuer("other");
            if (field.equals("aud")) builder.audience("other");
            if (field.equals("iat")) builder.issueTime(Date.from(clock.instant().plusSeconds(10)));
            var jwt = new com.nimbusds.jwt.SignedJWT(parsed.getHeader(), builder.build());
            jwt.sign(new com.nimbusds.jose.crypto.MACSigner(new byte[32]));
            unauthorized(() -> auth.authenticate(jwt.serialize()));
        }
        var jwt = new com.nimbusds.jwt.SignedJWT(parsed.getHeader(), parsed.getJWTClaimsSet());
        byte[] wrong = new byte[32];
        Arrays.fill(wrong, (byte) 7);
        jwt.sign(new com.nimbusds.jose.crypto.MACSigner(wrong));
        unauthorized(() -> auth.authenticate(jwt.serialize()));
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
