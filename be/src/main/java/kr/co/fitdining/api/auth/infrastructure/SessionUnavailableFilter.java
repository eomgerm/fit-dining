package kr.co.fitdining.api.auth.infrastructure;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.RedisSystemException;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Runs outside Spring Session, including its final synchronous session save.
 * Async responses bypass caching, so async failures and already committed responses cannot be
 * replaced with a 503 here. Async processing must start before obtaining/writing the response body:
 * previously obtained streams/writers still cache, and an already cached prefix is not replayed.
 * Synchronous responses (including large bodies) are still buffered in memory. ERROR and ASYNC
 * dispatches are not intercepted by this filter.
 */
@lombok.extern.slf4j.Slf4j
final class SessionUnavailableFilter extends OncePerRequestFilter {
    private final JsonMapper mapper;

    SessionUnavailableFilter(JsonMapper mapper) { this.mapper = mapper; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var buffered = new AsyncAwareResponse(response, request);
        try {
            chain.doFilter(request, buffered);
        } catch (RuntimeException | ServletException failure) {
            var redisCause = redisFailure(failure);
            if (redisCause == null || response.isCommitted()) throw failure;
            log.warn("Redis request unavailable: exceptionClass={}, path={}",
                    redisCause.getClass().getName(), request.getRequestURI());
            response.reset();
            SecurityConfiguration.writeProblem(mapper,
                    org.springframework.http.ProblemDetail.forStatusAndDetail(
                        org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                        hasSessionCookie(request)
                            ? "로그인 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요."
                            : "일시적으로 처리할 수 없어요. 잠시 후 다시 시도해 주세요."), request, response);
            return;
        }
        if (!buffered.isCachingDisabled()) buffered.copyBodyToResponse();
    }

    private static boolean hasSessionCookie(HttpServletRequest request) {
        var cookies = request.getCookies();
        if (cookies != null) {
            for (var cookie : cookies) {
                if (SessionConfiguration.SESSION_COOKIE_NAME.equals(cookie.getName())) return true;
            }
        }
        return false;
    }

    /** Like ShallowEtagHeaderFilter's conditional wrapper, choose the stream at access time. */
    private static final class AsyncAwareResponse extends ContentCachingResponseWrapper {
        private final HttpServletRequest request;
        private volatile boolean cachingDisabled;

        AsyncAwareResponse(HttpServletResponse response, HttpServletRequest request) {
            super(response);
            this.request = request;
        }

        boolean isCachingDisabled() {
            if (request.isAsyncStarted()) cachingDisabled = true;
            return cachingDisabled;
        }

        @Override public ServletOutputStream getOutputStream() throws IOException {
            return isCachingDisabled() ? getResponse().getOutputStream() : super.getOutputStream();
        }

        @Override public PrintWriter getWriter() throws IOException {
            return isCachingDisabled() ? getResponse().getWriter() : super.getWriter();
        }

        @Override public void flushBuffer() throws IOException {
            if (isCachingDisabled()) getResponse().flushBuffer();
            else super.flushBuffer();
        }
    }

    private static Throwable redisFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof RedisConnectionFailureException || cause instanceof RedisSystemException
                    || cause instanceof io.lettuce.core.RedisException) return cause;
        }
        return null;
    }
}
