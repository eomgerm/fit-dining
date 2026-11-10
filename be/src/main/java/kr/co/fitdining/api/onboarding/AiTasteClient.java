package kr.co.fitdining.api.onboarding;

import jakarta.validation.Valid;
import jakarta.validation.Validator;
import jakarta.validation.constraints.*;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import kr.co.fitdining.api.user.StoredTasteChip;
import kr.co.fitdining.api.user.TasteFeature;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** AI boundary. Never log payloads or exception messages containing response bodies. */
@Component
public class AiTasteClient {
    /** {@code user_preferences.tastes[].vector} dimension (profile-storage spec). */
    static final int VECTOR_DIMENSION = 1024;
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

    public InterpretResponse interpret(String text) {
        var response = interpret.post().uri("/v1/taste/interpret").contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("text", text)).retrieve().body(InterpretResponse.class);
        return checked(response);
    }

    /**
     * Features and chip vectors. {@code vectors} follows the chip order; it is kept only on chips that need one.
     * An AI without the field yields no vectors.
     * @throws IllegalStateException when the response breaks the contract
     */
    public TasteProfileService.Profile profile(Preferences preferences) {
        // Preferences contains only the four fields accepted by the AI contract.
        var response = post("/v1/taste/profile", preferences);
        var chips = preferences.tastes();
        var vectors = response.vectors();
        if (vectors != null && (vectors.size() != chips.size()
                || vectors.stream().anyMatch(vector -> vector != null && vector.length != VECTOR_DIMENSION)))
            throw new IllegalStateException("Invalid AI response");
        var tastes = IntStream.range(0, chips.size()).mapToObj(i -> StoredTasteChip.of(chips.get(i),
                vectors != null && StoredTasteChip.needsVector(chips.get(i)) ? vectors.get(i) : null)).toList();
        return new TasteProfileService.Profile(features(response), tastes);
    }

    /** 04:00 batch: stored answers plus current review evidence; only features are recomputed. */
    public List<TasteFeature> refresh(Preferences preferences, List<ReviewEvidence> reviews) {
        return features(post("/v1/taste/refresh", new RefreshRequest(preferences.mood(), preferences.priorities(),
                preferences.purposes(), preferences.tastes(), reviews)));
    }

    private ProfileResponse post(String uri, Object body) {
        return checked(profile.post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(ProfileResponse.class));
    }

    private static List<TasteFeature> features(ProfileResponse response) {
        return response.features().stream()
                .map(f -> new TasteFeature(f.code(), f.layer(), f.like(), f.weight(), f.category())).toList();
    }

    private <T> T checked(T response) {
        if (response == null || !validator.validate(response).isEmpty())
            throw new IllegalStateException("Invalid AI response");
        return response;
    }

    /**
     * One review reason tag (taste-profile spec, refresh API).
     * @param category 식당, 카페 or 술집 @param code user-side feature code @param createdAt review creation time
     * @param revisitIntent the review's revisit intent; it only makes that review's evidence weigh more
     */
    public record ReviewEvidence(long placeId, long reviewId, String category, String code, Instant createdAt,
            boolean revisitIntent) {}
    private record RefreshRequest(Preferences.Mood mood, List<Preferences.Priority> priorities,
            List<Preferences.Purpose> purposes, List<TasteChip> tastes, List<ReviewEvidence> reviews) {}

    public record InterpretResponse(@NotNull @Size(max = 10) List<@NotNull @Valid TasteChip> tastes,
            String model) {}
    public record Feature(@NotBlank @Pattern(regexp = "^[A-Z][A-Z0-9_]{0,63}$") String code,
            @NotNull @Pattern(regexp = "axis|importance|purpose|food") String layer, @NotNull Boolean like,
            @NotNull @DecimalMin(value = "0", inclusive = false) Double weight,
            @Pattern(regexp = "RESTAURANT|CAFE|BAR") String category) {}
    public record ProfileResponse(@NotNull List<@NotNull @Valid Feature> features, List<float[]> vectors) {}
}
