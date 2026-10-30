package kr.co.fitdining.api.onboarding;

import java.util.List;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "fitdining.onboarding.taste-analyzer", havingValue = "ai")
public class AiTasteAnalyzer implements TasteAnalyzer {
    private final AiTasteClient client;
    @Override public List<TasteChip> analyze(String text) { return client.interpret(text); }
}
