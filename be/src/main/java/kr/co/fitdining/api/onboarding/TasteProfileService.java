package kr.co.fitdining.api.onboarding;

import java.util.ArrayList;
import java.util.List;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.StoredTasteChip;
import kr.co.fitdining.api.user.TasteFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Called by signup orchestration before entering its database transaction. */
@Service
public class TasteProfileService {
    private static final Logger log = LoggerFactory.getLogger(TasteProfileService.class);
    private final AiTasteClient client;
    private final boolean enabled;
    public TasteProfileService(AiTasteClient client,
            @Value("${fitdining.ai.profile-enabled:false}") boolean enabled) {
        this.client = client;
        this.enabled = enabled;
    }

    /**
     * What signup stores next to the onboarding answers.
     * @param features computed profile, empty when AI is off or failed
     * @param tastes the answers' chips in order; uncoded LIKE chips carry a vector unless AI is off or failed
     */
    public record Profile(List<TasteFeature> features, List<StoredTasteChip> tastes) {}

    public Profile compute(Preferences preferences) {
        if (preferences == null) return new Profile(List.of(), List.of());
        if (!enabled) return new Profile(List.of(), withVectors(preferences.tastes(), List.of()));
        return new Profile(features(preferences), withVectors(preferences.tastes(), vectors(preferences.tastes())));
    }

    private List<TasteFeature> features(Preferences preferences) {
        try { return client.profile(preferences); }
        catch (RuntimeException failure) {
            log.warn("taste_profile_failed kind={}", failure.getClass().getSimpleName());
            return List.of();
        }
    }

    /** Vectors for the chips that need one, in chip order; empty when none or on failure (filled later by backfill). */
    private List<float[]> vectors(List<Preferences.TasteChip> chips) {
        var texts = chips.stream().filter(StoredTasteChip::needsVector).map(Preferences.TasteChip::label).toList();
        if (texts.isEmpty()) return List.of();
        try { return client.vectors(texts); }
        catch (RuntimeException failure) {
            log.warn("taste_vectors_failed kind={}", failure.getClass().getSimpleName());
            return List.of();
        }
    }

    private static List<StoredTasteChip> withVectors(List<Preferences.TasteChip> chips, List<float[]> vectors) {
        var next = vectors.iterator();
        var stored = new ArrayList<StoredTasteChip>(chips.size());
        for (var chip : chips)
            stored.add(StoredTasteChip.of(chip, StoredTasteChip.needsVector(chip) && next.hasNext() ? next.next() : null));
        return stored;
    }
}
