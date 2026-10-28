package kr.co.fitdining.api.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Base64;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 통합 테스트에 공통 PostgreSQL 컨테이너와 인증 설정을 제공하고 인증 스키마를 적용한다.
 */
public abstract class PostgresTestSupport {
    /**
     * {@code docker manifest inspect pgvector/pgvector:0.8.7-pg16}로 linux/arm64 변형을 확인했다(2026-10-26).
     * arm64 매니페스트: sha256:a45475a5bc7882f19e9ca17d49b67f665fa04d500350de2c47af325662445aec.
     * JVM 수명 동안 공유하며 JVM 종료 후 Ryuk이 정리한다.
     */
    protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:0.8.7-pg16").asCompatibleSubstituteFor("postgres"));

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
    protected static DataSource appSource() {
        return new DriverManagerDataSource(POSTGRES.getJdbcUrl(), "fit_dev_app", "test-app");
    }
}
