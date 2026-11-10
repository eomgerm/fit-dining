package compat.session192;

import static org.junit.jupiter.api.Assertions.*;
import java.time.Instant;
import java.util.UUID;
import compat.session192.model.AuthRefreshToken;
import compat.session192.model.AuthSecurityEvent;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** 192 mapping validation and its credential/RT-insert login contract on the V25 database. */
class LegacySchemaCompatibilityTests extends PostgresTestSupport {
    @Test void version192MappingsValidateAndLoginCanStillInsertRefreshTokensAfterV25() throws Exception {
        migrate();
        var config = new org.hibernate.cfg.Configuration()
            .addAnnotatedClass(AuthUser.class).addAnnotatedClass(AuthRefreshToken.class).addAnnotatedClass(AuthSecurityEvent.class)
            .setProperty("hibernate.connection.url", POSTGRES.getJdbcUrl())
            .setProperty("hibernate.connection.username", "fit_dev_app")
            .setProperty("hibernate.connection.password", "test-app")
            .setProperty("hibernate.hbm2ddl.auto", "validate")
            .setProperty("hibernate.physical_naming_strategy", "org.hibernate.boot.model.naming.PhysicalNamingStrategySnakeCaseImpl");
        String id = "compat-" + UUID.randomUUID();
        String email = id + "@example.com";
        String family = "compat-" + UUID.randomUUID();
        var jdbc = new JdbcTemplate(appSource());
        var passwords = new BCryptPasswordEncoder(4);
        Instant now = Instant.now();
        try (var factory = config.buildSessionFactory(); var session = factory.openSession()) {
            var tx = session.beginTransaction();
            session.persist(new AuthUser(id, email, "c" + UUID.randomUUID().toString().substring(0, 10),
                passwords.encode("password123"), now, "compat-192"));
            tx.commit();
            session.clear();
            tx = session.beginTransaction();
            var user = session.createQuery("from AuthUser where email=:email", AuthUser.class).setParameter("email", email).getSingleResult();
            assertTrue(passwords.matches("password123", user.getPasswordHash()));
            session.persist(new AuthRefreshToken(UUID.randomUUID().toString(), family, user.getId(), now, now.plusSeconds(86400)));
            session.persist(new AuthSecurityEvent(family, now, "REFRESH_REUSE", 1));
            tx.commit();
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_refresh_tokens where family_id=?", Integer.class, family));
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_security_events where family_id=? and user_id is null", Integer.class, family));
        } finally {
            jdbc.update("delete from auth_refresh_tokens where user_id=?", id);
            jdbc.update("delete from auth_security_events where family_id=?", family);
            jdbc.update("delete from auth_users where id=?", id);
        }
    }
}
