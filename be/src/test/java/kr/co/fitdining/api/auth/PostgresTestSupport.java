package kr.co.fitdining.api.auth;

import javax.sql.DataSource;
import java.sql.*;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;

@Testcontainers
public abstract class PostgresTestSupport {
    @Container protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");
    protected static synchronized void migrate() throws Exception {
        try (Connection connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                Statement sql = connection.createStatement()) {
            sql.execute("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fit_migrator') THEN CREATE ROLE fit_migrator LOGIN PASSWORD 'test-migrator'; CREATE ROLE fit_dev_app LOGIN PASSWORD 'test-app'; END IF; END $$");
            sql.execute("GRANT CREATE, USAGE ON SCHEMA public TO fit_migrator");
            sql.execute("GRANT USAGE ON SCHEMA public TO fit_dev_app");
            sql.execute("ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fit_dev_app");
            sql.execute("ALTER DEFAULT PRIVILEGES FOR ROLE fit_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO fit_dev_app");
        }
        Flyway.configure().dataSource(POSTGRES.getJdbcUrl(), "fit_migrator", "test-migrator").load().migrate();
    }
    protected static DataSource appSource() {
        return new DriverManagerDataSource(POSTGRES.getJdbcUrl(), "fit_dev_app", "test-app");
    }
}
