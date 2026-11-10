package kr.co.fitdining.api.support;

import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases.Identity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

public final class SessionTestSupport {
    private SessionTestSupport() {}
    public static RequestPostProcessor csrf() {
        return request -> {
            if (request.getHeader("X-XSRF-TOKEN") != null && request.getCookies() != null
                    && java.util.Arrays.stream(request.getCookies()).anyMatch(cookie -> cookie.getName().equals("XSRF-TOKEN")))
                return request;
            String value = java.util.UUID.randomUUID().toString();
            var cookies = new java.util.ArrayList<jakarta.servlet.http.Cookie>();
            if (request.getCookies() != null) cookies.addAll(java.util.Arrays.asList(request.getCookies()));
            cookies.removeIf(cookie -> cookie.getName().equals("XSRF-TOKEN"));
            cookies.add(new jakarta.servlet.http.Cookie("XSRF-TOKEN", value));
            request.setCookies(cookies.toArray(jakarta.servlet.http.Cookie[]::new));
            request.removeHeader("X-XSRF-TOKEN");
            request.addHeader("X-XSRF-TOKEN", value);
            return request;
        };
    }

    public static RequestPostProcessor session(String userId) {
        var principal = new Identity(userId, "nickname", java.time.Instant.now().getEpochSecond() + 86400);
        var context = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));
        return request -> {
            var session = request.getSession(true);
            session.setAttribute("SPRING_SECURITY_CONTEXT", context);
            session.setAttribute("auth.expiresAt", principal.sessionExpiresAt() * 1000);
            return request;
        };
    }

    /** Prepares the double-submit cookie/header without an anonymous HTTP session. */
    public static void csrf(java.net.http.HttpRequest.Builder builder, java.net.http.HttpClient client,
            int port, String cookies) throws Exception {
        var get = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:" + port + "/api/auth/csrf"));
        if (cookies != null) get.header("Cookie", cookies);
        var response = client.send(get.GET().build(), java.net.http.HttpResponse.BodyHandlers.discarding());
        String csrfCookie = response.headers().allValues("set-cookie").stream()
            .filter(value -> value.startsWith("XSRF-TOKEN=")).findFirst().orElse(null);
        if (csrfCookie == null && cookies != null) csrfCookie = java.util.Arrays.stream(cookies.split("; "))
            .filter(value -> value.startsWith("XSRF-TOKEN=")).findFirst().orElse(null);
        if (csrfCookie == null) throw new IllegalStateException("Missing CSRF cookie");
        csrfCookie = csrfCookie.split(";", 2)[0];
        builder.header("Cookie", (cookies == null ? "" : cookies + "; ") + csrfCookie);
        builder.header("X-XSRF-TOKEN", java.net.URLDecoder.decode(csrfCookie.substring(11), java.nio.charset.StandardCharsets.UTF_8));
    }

    public static String cookie(java.net.http.HttpResponse<?> response) {
        return response.headers().allValues("set-cookie").stream()
            .filter(value -> value.startsWith("fitdining_session=")).findFirst().orElseThrow().split(";", 2)[0];
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    public static String persist(org.springframework.session.FindByIndexNameSessionRepository repository, Identity identity) {
        org.springframework.session.Session session = repository.createSession();
        session.setAttribute("SPRING_SECURITY_CONTEXT", new SecurityContextImpl(
            UsernamePasswordAuthenticationToken.authenticated(identity, null, List.of())));
        session.setAttribute("auth.expiresAt", identity.sessionExpiresAt() * 1000);
        repository.save(session);
        return "fitdining_session=" + java.util.Base64.getEncoder().encodeToString(
            session.getId().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
