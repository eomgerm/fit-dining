package kr.co.fitdining.api.auth.infrastructure;

import jakarta.servlet.http.*;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import org.springframework.stereotype.Component;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.beans.factory.annotation.Value;

/** The only production entry point that creates an authenticated session. */
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
public class SessionLogin {
    private final CookieCsrfTokenRepository csrf;
    public SessionLogin(@Value("${auth.cookie-secure}") boolean secure) { csrf = SessionCsrf.repository(secure); }
    public void establish(Identity identity, HttpServletRequest request, HttpServletResponse response) {
        var previous = request.getSession(false);
        if (previous != null) previous.invalidate();
        request.getSession(true).setAttribute("auth.expiresAt", identity.sessionExpiresAt() * 1000L);
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(identity, null, java.util.List.of()));
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context, request, response);
        csrf.saveToken(csrf.generateToken(request), request, response);
    }
}
