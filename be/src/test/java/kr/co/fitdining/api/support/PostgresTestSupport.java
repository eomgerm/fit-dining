package kr.co.fitdining.api.support;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Base64;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 통합 테스트에 공통 PostgreSQL 컨테이너와 인증 설정을 제공하고 인증 스키마를 적용한다.
 */
public abstract class PostgresTestSupport extends RedisTestSupport {
    /**
     * {@code docker manifest inspect pgvector/pgvector:0.8.7-pg16}로 linux/arm64 변형을 확인했다(2026-10-26).
     * arm64 매니페스트: sha256:a45475a5bc7882f19e9ca17d49b67f665fa04d500350de2c47af325662445aec.
     * JVM 수명 동안 공유하며 JVM 종료 후 Ryuk이 정리한다.
     */
    protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:0.8.7-pg16").asCompatibleSubstituteFor("postgres"))
            // Cached Spring contexts retain separate pools against this shared container.
            // withCommand replaces Testcontainers' command, so preserve its fsync=off test optimization.
            .withCommand("postgres", "-c", "fsync=off", "-c", "max_connections=300");

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) throws Exception {
        migrate();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "fit_dev_app");
        registry.add("spring.datasource.password", () -> "test-app");
        registry.add("JWT_SECRET", () -> Base64.getEncoder().encodeToString(new byte[32]));
        registry.add("AUTH_FRONTEND_ORIGIN", () -> "http://localhost:3000");
        registry.add("AUTH_COOKIE_SECURE", () -> "false");
    }

    protected static synchronized void migrate() throws Exception {
        try (Connection connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                Statement sql = connection.createStatement()) {
            sql.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fit_migrator') THEN CREATE ROLE fit_migrator LOGIN PASSWORD 'test-migrator'; CREATE ROLE fit_dev_app LOGIN PASSWORD 'test-app'; END IF; END $$");
            sql.execute("GRANT CREATE, USAGE ON SCHEMA public TO fit_migrator");
            sql.execute("GRANT USAGE ON SCHEMA public TO fit_dev_app");
            sql.execute("ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fit_dev_app");
            sql.execute("ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO fit_dev_app");
            // 서버와 로컬도 관리자가 확장을 만든다(infra/data/ensure-databases.sh). fit_migrator는 만들 수 없다.
            sql.execute("CREATE EXTENSION IF NOT EXISTS vector");
        }
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), "fit_migrator", "test-migrator").load().migrate();
    }
    /**
     * 인증번호 확인을 마친 상태의 발송 기록을 바로 넣고 가입에 쓸 인증 토큰 원문을 돌려준다.
     * 인증번호 발송·확인 흐름 자체는 EmailVerificationTests가 검증한다.
     * @param email 가입 이메일. 서비스와 같은 방식으로 정규화한다
     * @param now 앱 Clock 기준 현재 시각. 토큰은 이 시각부터 30분 유효하다
     * @return 인증 토큰 원문
     */
    protected static String verifiedToken(String email, java.time.Instant now) {
        String token = java.util.UUID.randomUUID() + "-" + java.util.UUID.randomUUID();
        var timestamp = java.sql.Timestamp.from(now);
        new org.springframework.jdbc.core.JdbcTemplate(appSource()).update(
                "insert into auth_email_verifications(email, code_hash, attempts, created_at, expires_at, verified_at, "
                        + "token_hash, token_expires_at) values (?, 'test', 0, ?, ?, ?, ?, ?)",
                kr.co.fitdining.api.auth.application.AuthService.normalizeEmail(email), timestamp,
                java.sql.Timestamp.from(now.plusSeconds(600)), timestamp,
                kr.co.fitdining.api.auth.application.EmailVerifications.tokenHash(token),
                java.sql.Timestamp.from(now.plusSeconds(1800)));
        return token;
    }

    /** @param email 가입 이메일 @return 지금 시각 기준으로 만든 인증 토큰 원문 */
    protected static String verifiedToken(String email) { return verifiedToken(email, java.time.Instant.now()); }

    /**
     * 앱 계정(fit_dev_app) 연결. JVM에서 하나인 작은 pool이라 문장마다 새 연결(10~12ms)을 열지 않는다.
     * 연결을 직접 꺼내면 반드시 닫는다(try-with-resources). 닫힌 연결은 pool로 돌아간다.
     */
    protected static DataSource appSource() {
        return AppPool.SOURCE;
    }

    /** 컨테이너 관리자 계정 연결. {@link #appSource()}와 같은 방식의 pool이다. */
    protected static DataSource superuserSource() {
        return SuperuserPool.SOURCE;
    }

    /** 처음 쓸 때 만든다. 역할은 {@link #migrate()}가 만들므로 만들 때는 연결하지 않는다. */
    private static final class AppPool {
        static final DataSource SOURCE = pool("fit-dev-app", "fit_dev_app", "test-app");
    }

    private static final class SuperuserPool {
        static final DataSource SOURCE = pool("superuser", POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    /**
     * 연결을 꺼낼 때마다 {@code RESET ALL}로 session 설정을 기본값으로 되돌린다. 앞서 쓴 test가 {@code SET}으로 바꾼 값
     * (예: ReviewPersistenceTest의 {@code enable_seqscan})이 다른 test로 새지 않게 한다. autocommit과 격리 수준은 Hikari가 되돌린다.
     */
    private static DataSource pool(String name, String user, String password) {
        HikariConfig config = new HikariConfig();
        config.setPoolName("test-" + name);
        config.setJdbcUrl(POSTGRES.getJdbcUrl());
        config.setUsername(user);
        config.setPassword(password);
        config.setMaximumPoolSize(4);
        config.setMinimumIdle(0);
        config.setConnectionTimeout(10_000);
        config.setInitializationFailTimeout(-1);
        return new DelegatingDataSource(new HikariDataSource(config)) {
            @Override
            public Connection getConnection() throws SQLException {
                Connection connection = super.getConnection();
                try (Statement reset = connection.createStatement()) {
                    reset.execute("RESET ALL");
                } catch (SQLException failure) {
                    connection.close();
                    throw failure;
                }
                return connection;
            }
        };
    }
}
