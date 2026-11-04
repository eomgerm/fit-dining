package kr.co.fitdining.api.onboarding;

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
     *        (filled later by backfill)
     */
    public record Profile(List<TasteFeature> features, List<StoredTasteChip> tastes) {}

    public Profile compute(Preferences preferences) {
        if (preferences == null) return new Profile(List.of(), List.of());
        if (enabled) try { return client.profile(preferences); }
        catch (RuntimeException failure) {
            log.warn("taste_profile_failed kind={}", failure.getClass().getSimpleName());
        }
        return new Profile(List.of(), preferences.tastes().stream().map(chip -> StoredTasteChip.of(chip, null)).toList());
    }
}
