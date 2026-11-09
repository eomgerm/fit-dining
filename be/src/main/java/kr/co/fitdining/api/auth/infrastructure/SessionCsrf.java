package kr.co.fitdining.api.auth.infrastructure;

import java.io.IOException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.filter.OncePerRequestFilter;

/** Opt-in only: the current chain continues to disable CSRF. */
public final class SessionCsrf {
    private SessionCsrf() { }

    public static CookieCsrfTokenRepository repository(boolean secure) {
        var repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setCookieCustomizer(cookie -> cookie.secure(secure).sameSite("Lax").path("/"));
        return repository;
    }

    public static void configure(HttpSecurity http, boolean secure) throws Exception {
        http.csrf(csrf -> csrf.csrfTokenRepository(repository(secure)).spa());
    }

    /** Install after CsrfFilter when opting in; does not create a session. */
    public static final class CookieFilter extends OncePerRequestFilter {
        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            var token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
            if (token != null && request.getRequestURI().equals(request.getContextPath() + "/api/auth/csrf")) token.getToken();
            chain.doFilter(request, response);
        }
    }
}
