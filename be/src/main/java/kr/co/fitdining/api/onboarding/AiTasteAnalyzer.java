package kr.co.fitdining.api.onboarding;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "fitdining.onboarding.taste-analyzer", havingValue = "ai")
public class AiTasteAnalyzer implements TasteAnalyzer {
    private final AiTasteClient client;
    @Override public Interpretation analyze(String text) {
        var response = client.interpret(text);
        return new Interpretation(response.tastes(), response.model());
    }
}
