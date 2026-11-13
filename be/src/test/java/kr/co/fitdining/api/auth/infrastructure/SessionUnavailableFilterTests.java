package kr.co.fitdining.api.auth.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

class SessionUnavailableFilterTests {
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final SessionUnavailableFilter filter = new SessionUnavailableFilter(mapper);

    @ParameterizedTest
    @MethodSource("redisFailures")
    void unavailableUsesCookieAppropriateDetailAndLogsOnlyClassAndPath(boolean sessionCookie,
            Exception failure, Class<? extends Throwable> redisType) throws Exception {
        var request = new MockHttpServletRequest("GET", "/api/auth/me");
        request.setQueryString("token=sensitive-query");
        request.setCookies(new Cookie(sessionCookie ? SessionConfiguration.SESSION_COOKIE_NAME : "other", "sensitive-session-id"));
        var response = new MockHttpServletResponse();
        var logger = (Logger) LoggerFactory.getLogger(SessionUnavailableFilter.class);
        var logs = new ListAppender<ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            filter.doFilter(request, response, (req, res) -> {
                res.getWriter().write("success that must be discarded");
                if (failure instanceof jakarta.servlet.ServletException servletFailure) throw servletFailure;
                throw (RuntimeException) failure;
            });
            assertThat(response.getStatus()).isEqualTo(503);
            assertThat(response.getContentType()).startsWith("application/problem+json");
            var problem = mapper.readTree(response.getContentAsByteArray());
            assertThat(problem.get("detail").asString()).isEqualTo(sessionCookie
                    ? "로그인 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요."
                    : "일시적으로 처리할 수 없어요. 잠시 후 다시 시도해 주세요.");
            assertThat(problem.get("instance").asString()).isEqualTo("/api/auth/me");
            assertThat(response.getContentAsString()).doesNotContain("success that must be discarded");
            assertThat(logs.list).hasSize(1);
            var event = logs.list.getFirst();
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getThrowableProxy()).isNull();
            assertThat(event.getArgumentArray()).containsExactly(
                    redisType.getName(), "/api/auth/me");
            assertThat(event.getFormattedMessage()).doesNotContain(
                    "sensitive-exception-message", "sensitive-session-id", "sensitive-query", "token=");
        } finally {
            logger.detachAppender(logs); logs.stop();
        }
    }

    static java.util.stream.Stream<Arguments> redisFailures() {
        return java.util.stream.Stream.of(false, true).flatMap(cookie -> {
            String secret = "sensitive-exception-message sensitive-session-id";
            return java.util.stream.Stream.of(
                    Arguments.of(cookie, new RedisConnectionFailureException(secret), RedisConnectionFailureException.class),
                    Arguments.of(cookie, new jakarta.servlet.ServletException(secret,
                            new RedisConnectionFailureException(secret)), RedisConnectionFailureException.class),
                    Arguments.of(cookie, new jakarta.servlet.ServletException(secret,
                            new org.springframework.dao.QueryTimeoutException(secret,
                                    new io.lettuce.core.RedisCommandTimeoutException(secret))),
                            io.lettuce.core.RedisCommandTimeoutException.class));
        });
    }

    @Test
    void configuredSessionCookieUsesSharedName() {
        var request = new MockHttpServletRequest("GET", "/");
        var response = new MockHttpServletResponse();
        new SessionConfiguration().cookieSerializer(false).writeCookieValue(
                new org.springframework.session.web.http.CookieSerializer.CookieValue(request, response, "session-value"));
        assertThat(SessionConfiguration.SESSION_COOKIE_NAME).isEqualTo("fitdining_session");
        assertThat(response.getHeader("Set-Cookie")).startsWith(SessionConfiguration.SESSION_COOKIE_NAME + "=");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void asyncWritesDuringChainBypassBufferAndCanFlush(boolean writer) throws Exception {
        var request = new MockHttpServletRequest("GET", "/async");
        request.setAsyncSupported(true);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> {
            req.startAsync(req, res);
            write((HttpServletResponse) res, writer, "first event");
            res.flushBuffer();
            // The body and flush must reach the original response before the chain returns.
            assertThat(response.getContentAsString()).isEqualTo("first event");
            assertThat(response.isCommitted()).isTrue();
        });
        assertThat(response.getContentAsString()).isEqualTo("first event");
        request.getAsyncContext().complete();
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void asyncBodyWrittenAfterChainReturnsReachesOriginalResponse(boolean writer) throws Exception {
        var request = new MockHttpServletRequest("GET", "/async");
        request.setAsyncSupported(true);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> req.startAsync(req, res));
        assertThat(response.isCommitted()).isFalse();
        assertThat(response.getContentAsString()).isEmpty();
        var asyncResponse = (HttpServletResponse) request.getAsyncContext().getResponse();
        write(asyncResponse, writer, "later result");
        asyncResponse.flushBuffer();
        assertThat(response.getContentAsString()).isEqualTo("later result");
        assertThat(response.isCommitted()).isTrue();
        request.getAsyncContext().complete();
    }

    private static void write(HttpServletResponse response, boolean writer, String body) throws java.io.IOException {
        if (writer) response.getWriter().write(body);
        else response.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
    }
}
