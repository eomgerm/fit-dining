package kr.co.fitdining.api.onboarding;

import java.util.List;
import kr.co.fitdining.api.user.Preferences;
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
    public List<TasteFeature> compute(Preferences preferences) {
        if (!enabled || preferences == null) return List.of();
        try { return client.profile(preferences); }
        catch (RuntimeException failure) {
            log.warn("taste_profile_failed kind={}", failure.getClass().getSimpleName());
            return List.of();
        }
    }
}
