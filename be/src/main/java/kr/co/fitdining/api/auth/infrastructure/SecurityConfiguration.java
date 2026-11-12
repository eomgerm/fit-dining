package kr.co.fitdining.api.auth.infrastructure;

import jakarta.servlet.http.*;
import java.time.Clock;
import java.util.Set;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.*;
import kr.co.fitdining.api.auth.presentation.AuthExceptionHandler;
import org.springframework.context.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.*;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

@Import(SessionLogin.class)
@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfiguration {
    @Bean UserDetailsService userDetailsService() {
        return username -> { throw new UsernameNotFoundException("Password authentication is not configured"); };
    }
    static String path(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }
    static void failure(AuthExceptionHandler errors, JsonMapper mapper, AuthFailure failure,
            HttpServletRequest request, HttpServletResponse response) throws java.io.IOException {
        failure(errors, mapper, failure, request, response, null);
    }
    static void failure(AuthExceptionHandler errors, JsonMapper mapper, AuthFailure failure,
            HttpServletRequest request, HttpServletResponse response, String detail) throws java.io.IOException {
        var result = errors.auth(failure, request, response);
        var problem = result.getBody();
        if (detail != null) problem.setDetail(detail);
        writeProblem(mapper, problem, request, response);
    }
    static void writeProblem(JsonMapper mapper, org.springframework.http.ProblemDetail problem,
            HttpServletRequest request, HttpServletResponse response) throws java.io.IOException {
        problem.setInstance(java.net.URI.create(request.getRequestURI()));
        response.setStatus(problem.getStatus());
        response.setContentType("application/problem+json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        var body = new java.util.LinkedHashMap<String, Object>();
        if (problem.getType() != null) body.put("type", problem.getType().toString());
        if (problem.getTitle() != null) body.put("title", problem.getTitle());
        body.put("status", problem.getStatus());
        if (problem.getDetail() != null) body.put("detail", problem.getDetail());
        if (problem.getInstance() != null) body.put("instance", problem.getInstance().toString());
        if (problem.getProperties() != null) body.putAll(problem.getProperties());
        mapper.writeValue(response.getOutputStream(), body);
    }
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, org.springframework.beans.factory.ObjectProvider<AuthPolicy> policies,
            org.springframework.beans.factory.ObjectProvider<Clock> clocks,
            org.springframework.core.env.Environment environment, JsonMapper mapper) throws Exception {
        var policy = policies.getIfAvailable(StrictAuthPolicy::new);
        var clock = clocks.getIfAvailable(Clock::systemUTC);
        var origin = environment.getRequiredProperty("auth.frontend-origin");
        boolean secure = Boolean.parseBoolean(environment.getRequiredProperty("auth.cookie-secure"));
        var errors = new AuthExceptionHandler(environment);
        http.securityContext(context -> context.securityContextRepository(new HttpSessionSecurityContextRepository()).requireExplicitSave(true));
        http.addFilterBefore(new AbsoluteSessionExpiryFilter(policy, clock), SecurityContextHolderFilter.class);
        http.addFilterAfter(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                    jakarta.servlet.FilterChain chain) throws java.io.IOException, jakarta.servlet.ServletException {
                String path = path(request);
                try {
                    boolean originPath = path.startsWith("/api/auth/") || path.startsWith("/api/v1/users/")
                        || path.startsWith("/api/v1/onboarding/") || path.startsWith("/api/v1/me/search-threads");
                    if (policy.checkOrigin() && originPath && !path.equals("/api/auth/dev/token")
                            && Set.of("POST", "DELETE").contains(request.getMethod())
                            && !origin.equals(request.getHeader("Origin")))
                        throw new AuthFailure("Origin rejected.", 403);
                } catch (AuthFailure rejected) {
                    failure(errors, mapper, rejected, request, response);
                    return;
                }
                chain.doFilter(request, response);
            }
        }, SecurityContextHolderFilter.class);
        http.csrf(config -> config.csrfTokenRepository(SessionCsrf.repository(secure)).spa()
            .ignoringRequestMatchers("/api/auth/dev/token"));
        http.addFilterAfter(new SessionCsrf.CookieFilter(), CsrfFilter.class);
        return http.authorizeHttpRequests(authorize -> authorize
            .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
            // Boot's exposure configuration decides which actuator handlers exist; others remain 404.
            .requestMatchers("/actuator/**", "/healthz", "/api/v1/version").permitAll()
            .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/auth/login", "/api/auth/signup",
                "/api/auth/logout", "/api/auth/dev/token", "/api/auth/email-verifications", "/api/auth/email-verifications/confirm",
                "/api/auth/social/signup", "/api/v1/places/search", "/api/v1/places/nearby", "/api/v1/places/search/region", "/api/v1/places/*/reasons",
                "/api/v1/onboarding/taste-analysis").permitAll()
            .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/auth/social/signup", "/api/auth/csrf", "/api/auth/oauth/*", "/api/auth/oauth/*/callback",
                "/api/v1/places/suggest", "/api/v1/places/ids", "/api/v1/places/*", "/api/v1/places/*/reviews").permitAll()
            // 모임 공개 경로(meetup D-8). 지역 찾기, 지점 확인, 내 모임은 회원만이라 공개 GET보다 먼저 둔다.
            .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/meetups/areas", "/api/v1/meetups/area-check",
                "/api/v1/meetups/mine").authenticated()
            .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/meetups/*", "/api/v1/meetups/*/result",
                "/api/v1/meetups/*/preview").permitAll()
            .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/meetups/*/profiles",
                "/api/v1/meetups/*/profiles/*/session").permitAll()
            .requestMatchers(org.springframework.http.HttpMethod.PUT, "/api/v1/meetups/*/profiles/me/taste",
                "/api/v1/meetups/*/poll/votes/me").permitAll()
            .anyRequest().authenticated())
            .exceptionHandling(exceptions -> exceptions
                .authenticationEntryPoint((request, response, exception) -> failure(errors, mapper, new AuthFailure("Authentication required."), request, response))
                .accessDeniedHandler((request, response, exception) -> failure(errors, mapper,
                    new AuthFailure("Access denied.", 403), request, response,
                    exception instanceof org.springframework.security.web.csrf.CsrfException
                        ? "CSRF 토큰이 없거나 올바르지 않습니다." : null)))
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.NEVER))
            .formLogin(AbstractHttpConfigurer::disable).httpBasic(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable).requestCache(AbstractHttpConfigurer::disable)
            .headers(headers -> headers.defaultsDisabled().addHeaderWriter((request, response) -> {
                String path = path(request);
                if (path.startsWith("/api/")) response.setHeader("X-Content-Type-Options", "nosniff");
                if (path.startsWith("/api/auth/") || path.startsWith("/api/v1/users/") || path.startsWith("/api/v1/me/")
                    || path.startsWith("/api/v1/onboarding/") || path.startsWith("/api/v1/meetups"))
                    response.setHeader("Cache-Control", "no-store");
            })).build();
    }
}
