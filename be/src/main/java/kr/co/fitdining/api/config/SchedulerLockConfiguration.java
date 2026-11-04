package kr.co.fitdining.api.config;

import javax.sql.DataSource;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Scheduled jobs that must not run on both Blue/Green colors take a row in {@code shedlock} (V20,
 * infra BE contract #19). DB time keeps the two containers' clocks out of the decision.
 */
@Configuration
@ConditionalOnWebApplication
@EnableSchedulerLock(defaultLockAtMostFor = "PT1H")
public class SchedulerLockConfiguration {
    @Bean
    LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(JdbcTemplateLockProvider.Configuration.builder()
                .withJdbcTemplate(new JdbcTemplate(dataSource)).usingDbTime().build());
    }
}
