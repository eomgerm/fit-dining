package kr.co.fitdining.api.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

/** One Redis per test JVM, like PostgreSQL; Ryuk handles cleanup. */
public abstract class RedisTestSupport {
    protected static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.9-alpine"))
            .withExposedPorts(6379)
            .withCommand("redis-server", "--notify-keyspace-events", "Egx", "--requirepass", "test-redis");
    static { REDIS.start(); }

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("spring.data.redis.password", () -> "test-redis");
    }
}
