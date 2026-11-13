package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.net.URI;
import java.net.http.*;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.session.data.redis.RedisIndexedSessionRepository;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** Uses the database catalog rather than mock place data. Shared Redis stays running. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.datasource.hikari.maximum-pool-size=2", "place.mock.enabled=false"})
class RedisUnavailableCatalogTests extends PostgresTestSupport {
    @LocalServerPort int port;
    @MockitoSpyBean RedisIndexedSessionRepository sessions;

    @Test void publicDatabaseCatalogDoesNotAccessUnavailableSessionStorage() throws Exception {
        var configuration = new org.springframework.data.redis.connection.RedisStandaloneConfiguration("127.0.0.1", 1);
        var options = org.springframework.data.redis.connection.lettuce.LettuceClientConfiguration.builder()
                .commandTimeout(java.time.Duration.ofMillis(200)).shutdownTimeout(java.time.Duration.ZERO).build();
        var connection = new org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory(configuration, options);
        connection.afterPropertiesSet(); connection.start();
        try {
            var template = new org.springframework.data.redis.core.RedisTemplate<String, Object>();
            template.setConnectionFactory(connection); template.afterPropertiesSet();
            var unavailable = new RedisIndexedSessionRepository(template);
            doAnswer(call -> unavailable.findById(call.getArgument(0))).when(sessions).findById(anyString());
            var client = HttpClient.newHttpClient();
            String cookie = java.util.Base64.getEncoder().encodeToString("probe-session".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var failed = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/auth/me"))
                    .header("Cookie", "fitdining_session=" + cookie).GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(failed.statusCode()).isEqualTo(503);
            clearInvocations(sessions);
            var result = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/places/ids"))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(result.statusCode()).isEqualTo(200);
            assertThat(result.body()).startsWith("[");
            assertThat(result.headers().allValues("set-cookie")).noneMatch(value -> value.startsWith("fitdining_session="));
            verifyNoInteractions(sessions);
        } finally {
            doCallRealMethod().when(sessions).findById(anyString());
            connection.destroy();
        }
    }
}
