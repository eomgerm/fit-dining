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
    static final String SESSION_COOKIE_NAME = "fitdining_session";

    @Bean
    org.springframework.boot.web.servlet.FilterRegistrationBean<SessionUnavailableFilter> sessionUnavailableFilter(
            JsonMapper mapper, org.springframework.core.env.Environment environment) {
        var registration = new org.springframework.boot.web.servlet.FilterRegistrationBean<>(new SessionUnavailableFilter(mapper));
        registration.setOrder(environment.getProperty("spring.session.servlet.filter-order", Integer.class,
                org.springframework.session.web.http.SessionRepositoryFilter.DEFAULT_ORDER) - 1);
        return registration;
    }

    @Bean
    ConfigureRedisAction configureRedisAction() { return ConfigureRedisAction.NO_OP; }

    @Bean
    SessionRepositoryCustomizer<RedisIndexedSessionRepository> sessionTimeout(AuthPolicy policy) {
        return repository -> repository.setDefaultMaxInactiveInterval(Duration.ofSeconds(policy.sessionIdleSeconds()));
    }

    @Bean
    DefaultCookieSerializer cookieSerializer(@Value("${auth.cookie-secure}") boolean secure) {
        var cookie = new DefaultCookieSerializer();
        cookie.setCookieName(SESSION_COOKIE_NAME);
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
        // Allow only the production principal while preserving Security's restrictive validator.
        return JsonMapper.builder()
                .addModules(SecurityJacksonModules.getModules(SessionConfiguration.class.getClassLoader(),
                    tools.jackson.databind.jsontype.BasicPolymorphicTypeValidator.builder()
                        .allowIfSubType(kr.co.fitdining.api.auth.ports.AuthUseCases.Identity.class)))
                .build();
    }
}
