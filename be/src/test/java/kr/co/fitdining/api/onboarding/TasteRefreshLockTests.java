package kr.co.fitdining.api.onboarding;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import java.util.List;
import javax.sql.DataSource;
import kr.co.fitdining.api.config.SchedulerLockConfiguration;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

/** Blue/Green both fire at 04:00; the shedlock row lets only one color run per day (infra BE contract #19). */
class TasteRefreshLockTests extends PostgresTestSupport {
    JdbcTemplate jdbc = new JdbcTemplate(appSource());
    AiTasteClient client = mock(AiTasteClient.class);
    WebApplicationContextRunner runner = new WebApplicationContextRunner()
            .withUserConfiguration(SchedulerLockConfiguration.class, TasteRefreshBatch.class)
            .withBean(DataSource.class, PostgresTestSupport::appSource)
            .withBean(JdbcClient.class, () -> JdbcClient.create(appSource()))
            .withBean(JsonMapper.class, () -> JsonMapper.builder().build())
            .withBean(AiTasteClient.class, () -> client);

    @BeforeAll static void migrateOnce() throws Exception { migrate(); }

    @BeforeEach void setUp() {
        jdbc.update("delete from shedlock");
        // One target keeps the AI call observable.
        jdbc.update("delete from user_preferences");
        jdbc.update("delete from auth_users where id = 'trl-a'");
        jdbc.update("insert into auth_users(id, email, nickname, password_hash, created_at, age_confirmed_at, "
                + "terms_agreed_at, privacy_agreed_at, terms_version) values ('trl-a', 'trl-a@example.com', 'trla', "
                + "'x', now(), now(), now(), now(), 'v1')");
        jdbc.update("insert into user_preferences(user_id, created_at, updated_at) values ('trl-a', now(), now())");
        when(client.refresh(any(), any(), any())).thenReturn(new AiTasteClient.Refreshed(List.of(), false));
    }

    @AfterEach void cleanUp() {
        jdbc.update("delete from shedlock");
        jdbc.update("delete from user_preferences where user_id = 'trl-a'");
        jdbc.update("delete from auth_users where id = 'trl-a'");
    }

    @Test @DisplayName("잠금_기본은 꺼짐_배치 빈이 없다")
    void disabledByDefault() {
        runner.run(context -> assertThat(context).doesNotHaveBean(TasteRefreshBatch.class));
    }

    @Test @DisplayName("잠금_다른 색이 잡고 있으면_AI를 부르지 않는다")
    void heldByOtherColor_skips() {
        jdbc.update("insert into shedlock(name, lock_until, locked_at, locked_by) values "
                + "('taste-refresh', timezone('utc', now()) + interval '1 hour', timezone('utc', now()), 'green')");
        runner.withPropertyValues("fitdining.batch.enabled=true").run(context -> {
            context.getBean(TasteRefreshBatch.class).run();
            verifyNoInteractions(client);
        });
    }

    @Test @DisplayName("잠금_일찍 끝나도_같은 날 다시 깨어난 색은 건너뛴다")
    void finishedEarly_secondRunSkips() {
        runner.withPropertyValues("fitdining.batch.enabled=true").run(context -> {
            var batch = context.getBean(TasteRefreshBatch.class);
            batch.run();
            batch.run();
            verify(client, times(1)).refresh(any(), any(), any());
        });
    }
}
