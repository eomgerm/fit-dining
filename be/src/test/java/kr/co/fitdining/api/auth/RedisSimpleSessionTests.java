package kr.co.fitdining.api.auth;

import java.time.Duration;
import org.springframework.boot.test.context.SpringBootTest;

/** Runs the same Redis round trips against the actual Simple-policy application context. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.datasource.hikari.maximum-pool-size=2", "place.mock.enabled=true", "auth.simple.enabled=true"})
class RedisSimpleSessionTests extends RedisSessionTests {
    @Override
    Duration expectedIdleTimeout() { return Duration.ofHours(12); }
}
