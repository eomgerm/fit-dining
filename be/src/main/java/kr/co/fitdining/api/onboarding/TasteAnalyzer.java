package kr.co.fitdining.api.onboarding;

import java.util.List;
import kr.co.fitdining.api.user.Preferences.TasteChip;

/** Replaceable taste-analysis port; implementations must not log input or results. */
public interface TasteAnalyzer {
    /**
     * @param text normalized text of 1–100 characters
     * @return possibly empty confirmed taste candidates, at most ten, labels of 1–20 characters
     * @throws RuntimeException when the analyzer is unavailable; caller maps failure to 503
     */
    Interpretation analyze(String text);

    /** @param model the model that produced the chips, null when the analyzer does not say */
    record Interpretation(List<TasteChip> tastes, String model) {}
}
