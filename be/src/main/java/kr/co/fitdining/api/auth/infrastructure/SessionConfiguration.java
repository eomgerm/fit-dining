package kr.co.fitdining.api.auth.infrastructure;

import java.time.Duration;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.serializer.RedisSerializer;
import org.springframework.security.jackson.SecurityJacksonModules;
import org.springframework.session.config.SessionRepositoryCustomizer;
import org.springframework.session.data.redis.RedisIndexedSessionRepository;
import org.springframework.session.data.redis.config.ConfigureRedisAction;
import org.springframework.session.web.http.DefaultCookieSerializer;
import tools.jackson.databind.json.JsonMapper;

/** Boot configures the repository; non-web migrations do not load these beans. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SessionConfiguration {
    @Bean
    ConfigureRedisAction configureRedisAction() { return ConfigureRedisAction.NO_OP; }

    @Bean
    SessionRepositoryCustomizer<RedisIndexedSessionRepository> sessionTimeout(AuthPolicy policy) {
        return repository -> repository.setDefaultMaxInactiveInterval(Duration.ofSeconds(policy.sessionIdleSeconds()));
    }

    @Bean
    DefaultCookieSerializer cookieSerializer(@Value("${auth.cookie-secure}") boolean secure) {
        var cookie = new DefaultCookieSerializer();
        cookie.setCookieName("fitdining_session");
        cookie.setUseHttpOnlyCookie(true);
        cookie.setUseSecureCookie(secure);
        cookie.setSameSite("Lax");
        cookie.setCookiePath("/");
        return cookie;
    }

    @Bean
    RedisSerializer<Object> springSessionDefaultRedisSerializer() {
        return new SessionRedisSerializer(sessionMapper());
    }

    static JsonMapper sessionMapper() {
        // 191: allow the exact principal class using SecurityJacksonModules.getModules(loader,
        // BasicPolymorphicTypeValidator.builder().allowIfSubType(Identity.class)).
        // Preserve Security's restrictive validator; never allow an entire application package.
        return JsonMapper.builder()
                .addModules(SecurityJacksonModules.getModules(SessionConfiguration.class.getClassLoader()))
                .build();
    }
}
