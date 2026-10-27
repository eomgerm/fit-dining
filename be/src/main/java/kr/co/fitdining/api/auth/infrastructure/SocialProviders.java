package kr.co.fitdining.api.auth.infrastructure;

import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/** Provider differences and optional credentials, kept outside the shared OAuth flow. */
@Component
@ConditionalOnWebApplication
public class SocialProviders {
    private final Map<String, Provider> providers = new HashMap<>();
    public SocialProviders(Environment environment) {
        add(environment, "google", "https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://openidconnect.googleapis.com/v1/userinfo", "openid", true);
        add(environment, "kakao", "https://kauth.kakao.com/oauth/authorize", "https://kauth.kakao.com/oauth/token", "https://kapi.kakao.com/v2/user/me", null, true);
        add(environment, "naver", "https://nid.naver.com/oauth2.0/authorize", "https://nid.naver.com/oauth2.0/token", "https://openapi.naver.com/v1/nid/me", null, false);
    }

    private void add(Environment env, String name, String authorization, String token, String userinfo, String scope, boolean pkce) {
        String id = value(env.getProperty("AUTH_" + name.toUpperCase(Locale.ROOT) + "_CLIENT_ID"));
        String secret = value(env.getProperty("AUTH_" + name.toUpperCase(Locale.ROOT) + "_CLIENT_SECRET"));
        if ((id == null) != (secret == null)) throw new IllegalArgumentException("Both social credentials are required: " + name);
        if (id != null) providers.put(name, new Provider(name, authorization, token, userinfo, scope, pkce, id, secret));
    }

    private static String value(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    public Provider get(String name) {
        return Optional.ofNullable(providers.get(name)).orElseThrow(() -> new IllegalArgumentException("Disabled provider"));
    }

    /** @param name provider name @param authorization authorization endpoint @param token token endpoint @param userinfo user info endpoint @param scope optional scope @param pkce S256 support @param clientId client ID @param clientSecret confidential client secret */
    public record Provider(String name, String authorization, String token, String userinfo, String scope, boolean pkce, String clientId, String clientSecret) {
        @Override public String toString() {
            return "Provider[" + name + "]";
        }

        public String subject(Map<?, ?> body) {
            Object id = switch (name) {
                case "google" -> body.get("sub");
                case "kakao" -> body.get("id");
                case "naver" -> body.get("response") instanceof Map<?, ?> nested ? nested.get("id") : null;
                default -> null;
            };
            if (id == null || id.toString().isBlank() || (name.equals("kakao") && !(id instanceof Number))) throw new IllegalArgumentException("Missing provider identity");
            return id.toString();
        }
    }
}
