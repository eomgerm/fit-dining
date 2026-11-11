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
    /** 04:00 batch calls (body extraction, refresh); they may wait for an LLM batch or an embedding cold start. */
    private final RestClient batch;
    private final Validator validator;

    @org.springframework.beans.factory.annotation.Autowired
    public AiTasteClient(Validator validator,
            @Value("${fitdining.ai.base-url:http://localhost:8000}") String baseUrl,
            @Value("${fitdining.ai.modal-key:}") String key,
            @Value("${fitdining.ai.modal-secret:}") String secret,
            @Value("${fitdining.onboarding.timeout-ms:10000}") long interpretTimeout,
            @Value("${fitdining.ai.profile-timeout-ms:3000}") long profileTimeout,
            @Value("${fitdining.ai.batch-timeout-ms:150000}") long batchTimeout) {
        this(client(baseUrl, key, secret, interpretTimeout), client(baseUrl, key, secret, profileTimeout),
                client(baseUrl, key, secret, batchTimeout), validator);
    }

    AiTasteClient(RestClient interpret, RestClient profile, Validator validator) {
        this(interpret, profile, profile, validator);
    }

    AiTasteClient(RestClient interpret, RestClient profile, RestClient batch, Validator validator) {
        this.interpret = interpret;
        this.profile = profile;
        this.batch = batch;
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

    /**
     * Chips for the onboarding text. A LIKE chip without a code carries its vector when the AI sent one, so a guest
     * device can keep it (taste-profile spec 4단계). An AI without {@code vectors} yields chips without vectors.
     * @throws IllegalStateException when the response breaks the contract
     */
    public InterpretResponse interpret(String text) {
        var response = checked(interpret.post().uri("/v1/taste/interpret").contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("text", text)).retrieve().body(InterpretResponse.class));
        var chips = response.tastes();
        var vectors = response.vectors();
        if (vectors == null) return response;
        if (vectors.size() != chips.size()
                || vectors.stream().anyMatch(vector -> vector != null && vector.length != VECTOR_DIMENSION))
            throw new IllegalStateException("Invalid AI response");
        return new InterpretResponse(IntStream.range(0, chips.size()).mapToObj(i -> {
            var chip = chips.get(i);
            return StoredTasteChip.needsVector(chip) && vectors.get(i) != null
                    ? new TasteChip(chip.polarity(), chip.label(), chip.code(), vectors.get(i)) : chip;
        }).toList(), response.model(), null);
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
        return new TasteProfileService.Profile(features(response.features()), tastes);
    }

    /**
     * 04:00 batch: stored answers (chips with their stored vectors) plus current review evidence (reason tags and
     * extracted body items); only features are recomputed.
     * @return features and whether the AI failed to embed review phrases. On failure the features hold no bundles and
     *     the caller keeps the stored ones (taste-profile spec 4단계)
     */
    public Refreshed refresh(Preferences preferences, List<ReviewEvidence> reviews, List<ReviewBody> bodies) {
        var response = checked(batch.post().uri("/v1/taste/refresh").contentType(MediaType.APPLICATION_JSON)
                .body(new RefreshRequest(preferences.mood(), preferences.priorities(), preferences.purposes(),
                        preferences.tastes(), reviews, bodies)).retrieve().body(RefreshResponse.class));
        return new Refreshed(features(response.features()), Boolean.TRUE.equals(response.embeddingFailed()));
    }

    /**
     * Extracts review bodies, at most {@link #EXTRACT_BATCH} per call (one LLM call on the AI side).
     * @return items per review, in request order
     * @throws IllegalStateException when the response breaks the contract
     */
    public Extraction extract(List<ReviewText> reviews) {
        var response = checked(batch.post().uri("/v1/reviews/extract").contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("reviews", reviews)).retrieve().body(Extraction.class));
        if (!response.results().stream().map(ExtractedReview::reviewId).toList()
                .equals(reviews.stream().map(ReviewText::reviewId).toList())
                || !response.results().stream().flatMap(r -> r.items().stream()).allMatch(ExtractedItem::signed))
            throw new IllegalStateException("Invalid AI response");
        return response;
    }

    private ProfileResponse post(String uri, Object body) {
        return checked(profile.post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                .body(body).retrieve().body(ProfileResponse.class));
    }

    private static List<TasteFeature> features(List<Feature> features) {
        if (!features.stream().allMatch(Feature::shaped)) throw new IllegalStateException("Invalid AI response");
        return features.stream().map(f -> new TasteFeature(f.code(), f.layer(), f.like(), f.weight(), f.category(),
                f.text(), f.vector())).toList();
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
    /**
     * One review's extracted body items for the refresh (taste-profile spec 2단계). Same review fields as the tags.
     * @param items stored items without slot and quote
     */
    public record ReviewBody(long placeId, long reviewId, String category, Instant createdAt, boolean revisitIntent,
            List<BodyItem> items) {}
    /**
     * @param slot extraction slot; the AI leaves the visit-context slot out of taste bundles
     * @param liked flavor codes only @param kind taste, facility, quality or budget
     */
    public record BodyItem(String slot, String code, int direction, Integer liked, String kind, String text) {}
    private record RefreshRequest(Preferences.Mood mood, List<Preferences.Priority> priorities,
            List<Preferences.Purpose> purposes, List<TasteChip> tastes, List<ReviewEvidence> reviews,
            List<ReviewBody> bodies) {}
    /** @param embeddingFailed true when the features hold no bundles because review phrases were not embedded */
    public record Refreshed(List<TasteFeature> features, boolean embeddingFailed) {}

    /** Reviews per extraction call. Same as the AI extractor's batch size. */
    public static final int EXTRACT_BATCH = 10;
    public record ReviewText(long reviewId, String body) {}
    public record Extraction(@NotNull @Size(max = EXTRACT_BATCH) List<@NotNull @Valid ExtractedReview> results,
            @NotBlank String model, @NotNull Integer promptVersion) {}
    public record ExtractedReview(@NotNull Long reviewId, @NotNull List<@NotNull @Valid ExtractedItem> items) {}
    /**
     * One extracted item, stored as is. {@code direction} is 1 or -1 and means whether the flavor occurred for flavor
     * codes; {@code liked} is 1, -1 or null.
     */
    public record ExtractedItem(@NotNull String slot, @NotNull String quote,
            @Pattern(regexp = "^[A-Z][A-Z0-9_]{0,63}$") String code, @NotNull Integer direction, Integer liked,
            @NotNull @Pattern(regexp = "taste|facility|quality|budget") String kind, String text) {
        boolean signed() {
            return Math.abs(direction) == 1 && (liked == null || Math.abs(liked) == 1);
        }
    }

    public record InterpretResponse(@NotNull @Size(max = 10) List<@NotNull @Valid TasteChip> tastes,
            String model, List<float[]> vectors) {}
    /**
     * A code feature, or a taste bundle when {@code code} is null: then {@code layer} is null, it is liked, and it
     * carries the representative {@code text} and its 1024-dim {@code vector}.
     */
    public record Feature(@Pattern(regexp = "^[A-Z][A-Z0-9_]{0,63}$") String code,
            @Pattern(regexp = "axis|importance|purpose|food") String layer, @NotNull Boolean like,
            @NotNull @DecimalMin(value = "0", inclusive = false) Double weight,
            @Pattern(regexp = "RESTAURANT|CAFE|BAR") String category, @Size(max = 100) String text, float[] vector) {
        boolean shaped() {
            if (code != null) return layer != null && text == null && vector == null;
            return layer == null && like && text != null && !text.isBlank() && vector != null
                    && vector.length == VECTOR_DIMENSION;
        }
    }
    public record ProfileResponse(@NotNull List<@NotNull @Valid Feature> features, List<float[]> vectors) {}
    public record RefreshResponse(@NotNull List<@NotNull @Valid Feature> features, Boolean embeddingFailed) {}
}
