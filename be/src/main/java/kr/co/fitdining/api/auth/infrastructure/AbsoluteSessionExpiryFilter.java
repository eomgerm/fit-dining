package kr.co.fitdining.api.auth.infrastructure;

import java.io.IOException;
import java.time.Clock;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/** Not a bean: 191 must install before loading the session SecurityContext. */
public final class AbsoluteSessionExpiryFilter extends OncePerRequestFilter {
    private final AuthPolicy policy;
    private final Clock clock;

    public AbsoluteSessionExpiryFilter(AuthPolicy policy, Clock clock) {
        this.policy = policy;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var session = request.getSession(false);
        if (session != null && clock.millis() - session.getCreationTime() >= policy.sessionSeconds() * 1000L) {
            session.invalidate();
            SecurityContextHolder.clearContext();
        }
        chain.doFilter(request, response);
    }
}
