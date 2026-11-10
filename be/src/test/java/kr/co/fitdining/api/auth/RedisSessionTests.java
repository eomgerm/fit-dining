package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.session.data.redis.RedisIndexedSessionRepository;
import org.springframework.session.SessionRepository;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.datasource.hikari.maximum-pool-size=2", "place.mock.enabled=true"})
class RedisSessionTests extends PostgresTestSupport {
    @LocalServerPort int port;
    @Autowired SessionRepository<?> repository;
    @Autowired RedisConnectionFactory redis;
    @Autowired StringRedisTemplate strings;
    @Value("${spring.session.data.redis.namespace}") String namespace;

    Duration expectedIdleTimeout() { return Duration.ofHours(2); }

    @Test
    void indexedRepositoryAndConnection() {
        assertThat(repository).isInstanceOf(RedisIndexedSessionRepository.class);
        try (var connection = redis.getConnection()) { assertThat(connection.ping()).isEqualTo("PONG"); }
        var indexed = (RedisIndexedSessionRepository) repository;
        var session = indexed.createSession();
        assertThat(session.getMaxInactiveInterval()).isEqualTo(expectedIdleTimeout());
        // Redis stores Spring Session timestamps as epoch milliseconds.
        var created = session.getCreationTime().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        var accessed = session.getLastAccessedTime().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        var oldId = session.getId();
        session.setAttribute("value", "roundtrip");
        session.setAttribute("userId", 42L);
        session.setAttribute("count", 42);
        indexed.save(session);
        assertThat(namespace).startsWith("fitdining:session:");
        assertThat(strings.hasKey(namespace + ":sessions:" + oldId)).isTrue();
        session = indexed.findById(oldId);
        session.changeSessionId();
        assertThat(session.getId()).isNotEqualTo(oldId);
        assertThat(session.getCreationTime()).isEqualTo(created);
        indexed.save(session);
        try {
            var restored = indexed.findById(session.getId());
            assertThat(restored.<String>getAttribute("value")).isEqualTo("roundtrip");
            assertThat(restored.<Object>getAttribute("userId")).isEqualTo(42L).isExactlyInstanceOf(Long.class);
            assertThat(restored.<Object>getAttribute("count")).isEqualTo(42).isExactlyInstanceOf(Integer.class);
            assertThat(restored.getCreationTime()).isEqualTo(created);
            assertThat(restored.getLastAccessedTime()).isEqualTo(accessed);
            assertThat(restored.getMaxInactiveInterval()).isEqualTo(expectedIdleTimeout());
            assertThat(indexed.findById(oldId)).isNull();
            var key = namespace + ":sessions:" + session.getId();
            assertThat(strings.hasKey(key)).isTrue();
            assertThat(strings.opsForHash().get(key, "creationTime").toString()).contains("Long");
            assertThat(strings.opsForHash().get(key, "lastAccessedTime").toString()).contains("Long");
            assertThat(strings.opsForHash().get(key, "maxInactiveInterval").toString()).contains("Integer");
        }
        finally {
            indexed.deleteById(session.getId());
            indexed.deleteById(oldId);
        }
    }

    @Test
    void anonymousGetAndCsrfProtectedPostDoNotCreateSession() throws Exception {
        var client = HttpClient.newHttpClient();
        var get = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/healthz")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(get.statusCode()).isEqualTo(200);
        assertThat(get.headers().allValues("set-cookie")).noneMatch(cookie -> cookie.startsWith("fitdining_session="));
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/places/search"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"query\":\"salad\"}"));
        kr.co.fitdining.api.support.SessionTestSupport.csrf(builder, client, port, null);
        var post = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        assertThat(post.statusCode()).isEqualTo(200);
        assertThat(post.headers().allValues("set-cookie")).noneMatch(cookie -> cookie.startsWith("fitdining_session="));
    }
}
