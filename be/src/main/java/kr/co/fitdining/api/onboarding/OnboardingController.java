package kr.co.fitdining.api.onboarding;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import kr.co.fitdining.api.auth.domain.AuthText;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.web.bind.annotation.*;

@RestController @ConditionalOnWebApplication @RequiredArgsConstructor
@RequestMapping("/api/v1/onboarding")
public class OnboardingController {
    private final TasteAnalysisService analysis;
    /** @param text trimmed free text, 1–100 characters */
    public record AnalysisRequest(@NotBlank @Size(max = 100) String text) {
        public AnalysisRequest { text = AuthText.strip(text); }
    }
    /** @param tastes nonempty analysis results */
    public record AnalysisResponse(List<TasteChip> tastes) {}
    @PostMapping("/taste-analysis")
    public AnalysisResponse analyze(@Valid @RequestBody AnalysisRequest body, HttpServletRequest request) {
        return new AnalysisResponse(analysis.analyze(body.text(), request.getRemoteAddr()));
    }
}
