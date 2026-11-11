package kr.co.fitdining.api.auth.infrastructure;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/** Provider tokens live only for the duration of this exchange and are never persisted. */
@Component
@ConditionalOnWebApplication
public class SocialProviderClient {
    private final RestClient client;
    @Autowired
    public SocialProviderClient() {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        factory.setReadTimeout(Duration.ofSeconds(5));
        client = RestClient.builder().requestFactory(factory).build();
    }

    public SocialProviderClient(RestClient client) {
        this.client = client;
    }

    public record Profile(String subject, String email) {}

    public Profile exchange(SocialProviders.Provider provider, String code, String state, String verifier, String redirect) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", provider.clientId());
        form.add("client_secret", provider.clientSecret());
        form.add("code", code);
        form.add("redirect_uri", redirect);
        if (provider.pkce()) form.add("code_verifier", verifier);
        if (provider.name().equals("naver")) form.add("state", state);
        Map<?, ?> token = client.post().uri(provider.token()).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(Map.class);
        if (token == null || !(token.get("access_token") instanceof String access) || access.isBlank()) throw new IllegalArgumentException("Missing provider token");
        var request = client.get().uri(provider.userinfo()).header("Authorization", "Bearer " + access);
        Map<?, ?> profile = request.retrieve().body(Map.class);
        if (profile == null) throw new IllegalArgumentException("Missing provider profile");
        return new Profile(provider.subject(profile), provider.email(profile));
    }
}
