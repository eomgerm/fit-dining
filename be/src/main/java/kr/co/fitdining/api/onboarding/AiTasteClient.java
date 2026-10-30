package kr.co.fitdining.api.onboarding;

import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import kr.co.fitdining.api.user.TasteFeature;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** AI boundary. Never log payloads or exception messages containing response bodies. */
@Component
public class AiTasteClient {
    private final RestClient interpret;
    private final RestClient profile;
    private final Validator validator;

    @org.springframework.beans.factory.annotation.Autowired
    public AiTasteClient(Validator validator,
            @Value("${fitdining.ai.base-url:http://localhost:8000}") String baseUrl,
            @Value("${fitdining.ai.modal-key:}") String key,
            @Value("${fitdining.ai.modal-secret:}") String secret,
            @Value("${fitdining.onboarding.timeout-ms:10000}") long interpretTimeout,
            @Value("${fitdining.ai.profile-timeout-ms:3000}") long profileTimeout) {
        this(client(baseUrl, key, secret, interpretTimeout), client(baseUrl, key, secret, profileTimeout), validator);
    }

    AiTasteClient(RestClient interpret, RestClient profile, Validator validator) {
        this.interpret = interpret;
        this.profile = profile;
        this.validator = validator;
    }

    private static RestClient client(String url, String key, String secret, long timeoutMs) {
        Duration timeout = Duration.ofMillis(timeoutMs);
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(timeout).build());
        factory.setReadTimeout(timeout);
        var builder = RestClient.builder().baseUrl(url).requestFactory(factory);
        if (!key.isBlank()) builder.defaultHeader("Modal-Key", key);
        if (!secret.isBlank()) builder.defaultHeader("Modal-Secret", secret);
        return builder.build();
    }

    public List<Preferences.TasteChip> interpret(String text) {
        var response = interpret.post().uri("/v1/taste/interpret").contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("text", text)).retrieve().body(InterpretResponse.class);
        return checked(response).tastes();
    }

    public List<TasteFeature> profile(Preferences preferences) {
        // Preferences contains only the four fields accepted by the AI contract.
        var response = profile.post().uri("/v1/taste/profile").contentType(MediaType.APPLICATION_JSON)
                .body(preferences).retrieve().body(ProfileResponse.class);
        return checked(response).features().stream()
                .map(f -> new TasteFeature(f.code(), f.layer(), f.like(), f.weight())).toList();
    }

    private <T> T checked(T response) {
        if (response == null || !validator.validate(response).isEmpty())
            throw new IllegalStateException("Invalid AI response");
        return response;
    }

    public record InterpretResponse(@NotNull @Size(max = 10) List<@NotNull @Valid TasteChip> tastes,
            String model) {}
    public record Feature(@NotBlank @Pattern(regexp = "^[A-Z][A-Z0-9_]{0,63}$") String code,
            @NotNull @Pattern(regexp = "axis|importance|purpose|food") String layer, @NotNull Boolean like,
            @NotNull @Min(1) @Max(3) Integer weight) {}
    public record ProfileResponse(@NotNull List<@NotNull @Valid Feature> features) {}
}
