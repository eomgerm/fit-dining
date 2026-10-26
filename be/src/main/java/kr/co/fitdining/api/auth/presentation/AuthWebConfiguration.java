package kr.co.fitdining.api.auth.presentation;

import java.net.URI;
import org.springframework.web.method.HandlerMethod;
import java.util.Set;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;

public class AuthWebConfiguration implements WebMvcConfigurer {
    private final AuthUseCases auth;
    private final String origin;
    public AuthWebConfiguration(AuthUseCases auth, @Value("${auth.frontend-origin}") String origin,
            @Value("${auth.cookie-secure}") String secure) {
        URI uri = URI.create(origin);
        if (origin.isBlank() || uri.getHost() == null || !Set.of("http", "https").contains(uri.getScheme())
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty()))
            throw new IllegalArgumentException("A valid frontend origin is required");
        if (!Set.of("true", "false").contains(secure)) throw new IllegalArgumentException("Cookie secure must be true or false");
        this.auth = auth; this.origin = origin;
    }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            private final Set<String> protectedPaths = Set.of("/api/auth/me", "/api/auth/protected");
            @Override public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                if (!(handler instanceof HandlerMethod method)
                        || !(AuthController.class.isAssignableFrom(method.getBeanType())
                        || kr.co.fitdining.api.user.UserController.class.isAssignableFrom(method.getBeanType()))) return true;
                response.setHeader("Cache-Control", "no-store");
                response.setHeader("X-Content-Type-Options", "nosniff");
                if (request.getMethod().equals("OPTIONS")) return true;
                if (request.getMethod().equals("POST") && !origin.equals(request.getHeader("Origin")))
                    throw new AuthFailure("허용되지 않은 요청 출처입니다.", 403);
                String path = request.getRequestURI().substring(request.getContextPath().length());
                if (!protectedPaths.contains(path) && !path.startsWith("/api/v1/users/")) return true;
                String header = request.getHeader("Authorization");
                if (header == null || !header.startsWith("Bearer ")) throw new AuthFailure("로그인이 필요합니다.");
                request.setAttribute("auth.identity", auth.authenticate(header.substring(7)));
                return true;
            }
        }).addPathPatterns("/api/auth/**", "/api/v1/users/**");
    }
}
