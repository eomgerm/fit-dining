package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.persistence.EntityManagerFactory;
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
    JdbcTemplate jdbc;

    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) throws Exception {
        migrate();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "fit_dev_app");
        registry.add("spring.datasource.password", () -> "test-app");
        registry.add("JWT_SECRET", () -> java.util.Base64.getEncoder().encodeToString(new byte[32]));
        registry.add("AUTH_FRONTEND_ORIGIN", () -> "http://localhost:3000");
        registry.add("AUTH_COOKIE_SECURE", () -> "false");
        registry.add("spring.jpa.properties.hibernate.generate_statistics", () -> "true");
        registry.add("auth.cleanup.batch-size", () -> "2");
    }

    @BeforeEach void setup() {
        clock.instant = Instant.parse("2026-10-23T00:00:00Z");
        passwords.entered = null;
        passwords.release = null;
        jdbc = new JdbcTemplate(appSource());
        for (String table : List.of("auth_refresh_tokens", "auth_security_events", "auth_login_attempts", "auth_users")) {
            jdbc.update("delete from " + table);
        }
        users.saveAndFlush(new AuthUser("user-1", "demo", passwords.hash("example-test-password"), clock.instant()));
    }

    AuthUseCases.Issued login() { return auth.login("demo", "example-test-password", "ip"); }
    void unauthorized(org.junit.jupiter.api.function.Executable work) {
        assertEquals(401, assertThrows(AuthFailure.class, work).status());
    }

    @Test @DisplayName("로그아웃_두 묶음 중 하나 폐기_RT만 차단하고 AT 유지")
    void logout_twoFamilies_revokesRefreshButKeepsAccessUntilExpiry() {
        var first = login();
        var second = login();
        auth.logout(auth.authenticate(first.accessToken()));
        unauthorized(() -> auth.refresh(first.refreshToken()));
        assertEquals("demo", auth.authenticate(first.accessToken()).username());
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
        String at = codec.encode(new TokenCodec.Token("user-1", "demo", "new-family", "unknown", "access", now, now + 100, now + 1000));
        assertNotNull(auth.authenticate(at));
        String rt = codec.encode(new TokenCodec.Token("user-1", "demo", "new-family", "unknown", "refresh", now, now + 1000, now + 1000));
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
                () -> auth.logout(current.identity()),
                () -> unauthorized(() -> auth.refresh(first.refreshToken())));
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events", Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_refresh_tokens where revoked_at is null", Integer.class));
    }

    @Test @DisplayName("폐기 사유_로그아웃 후 옛 RT 재사용_최초 사유와 시각 보존")
    void refresh_replayAfterLogout_preservesOriginalRevocationReasonAndTime() {
        var first = login();
        var current = auth.refresh(first.refreshToken());
        auth.logout(current.identity());
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
        users.saveAndFlush(new AuthUser("user-2", "other", passwords.hash("example-test-password"), clock.instant()));
        var first = auth.login("other", "example-test-password", "other-ip");
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
            jdbc.update("insert into auth_login_attempts(address,created_at) values (?,?)", "old", java.sql.Timestamp.from(clock.instant().minusSeconds(901)));
        }
        jdbc.update("insert into auth_login_attempts(address,created_at) values (?,?)", "boundary", java.sql.Timestamp.from(clock.instant().minusSeconds(900)));
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
        transactions.seedUser("demo", passwords.hash("another-test-password"));
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
    void migrate_withoutAuthEnvironment_startsAndCloses() {
        try (var context = new SpringApplicationBuilder(ApiApplication.class).web(WebApplicationType.NONE)
                .profiles("migrate").properties("spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "spring.datasource.username=fit_migrator", "spring.datasource.password=test-migrator",
                        "auth.jwt-secret=${UNDEFINED_AUTH_KEY}", "auth.frontend-origin=${UNDEFINED_AUTH_ORIGIN}",
                        "auth.cookie-secure=${UNDEFINED_AUTH_SECURE}").run(
                        "--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                        "--spring.datasource.username=fit_migrator", "--spring.datasource.password=test-migrator")) {
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
        @Override public String hash(String password) {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
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
