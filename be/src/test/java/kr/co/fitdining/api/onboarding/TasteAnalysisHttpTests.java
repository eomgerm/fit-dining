package kr.co.fitdining.api.onboarding;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Clock;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.presentation.AuthWebConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
@WebMvcTest(controllers = OnboardingController.class, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@Import({AuthWebConfiguration.class, MockTasteAnalyzer.class, TasteAnalysisService.class, TasteAnalysisHttpTests.Configuration.class})
class TasteAnalysisHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    static class Configuration { @Bean Clock clock() { return Clock.systemUTC(); } }
    @Autowired MockMvc mvc;
    @MockitoBean AuthUseCases auth;
    @MockitoBean TasteInputLogs logs;
    @org.springframework.test.context.bean.override.mockito.MockitoSpyBean MockTasteAnalyzer analyzer;
    @Test void analyze_empty_returns200() throws Exception {
        org.mockito.Mockito.doReturn(new TasteAnalyzer.Interpretation(java.util.List.of(), "mock")).when(analyzer).analyze("empty");
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"text\":\"empty\"}"))
                .andExpect(status().isOk()).andExpect(content().json("{\"tastes\":[]}"));
    }
    @Test @DisplayName("분석_API 예문_기대 칩 반환")
    void analyze_sample_returnsChips() throws Exception {
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"text\":\"담백한 국물 좋아하고 너무 매운 건 별로예요\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.tastes[0].label").value("담백한 국물"))
                .andExpect(jsonPath("$.tastes[1].polarity").value("DISLIKE"));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"", "   ", "LONG"})
    @DisplayName("분석_빈 입력과 길이 초과_400")
    void analyze_invalidText_returns400(String text) throws Exception {
        if (text.equals("LONG")) text = "a".repeat(101);
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"text\":\"" + text + "\"}"))
                .andExpect(status().isBadRequest());
    }
    @Test @DisplayName("분석_Mock 실패_내용 없는 일반 503")
    void analyze_mockFailure_returns503(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"text\":\"#실패 민감한입력\"}"))
                .andExpect(status().isServiceUnavailable()).andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("민감한입력"))));
        org.junit.jupiter.api.Assertions.assertFalse(output.getAll().contains("민감한입력"));
    }
    @Test @DisplayName("분석_기록 실패_200 응답과 로그에 원문 없음")
    void analyze_logFailure_returns200WithoutLoggingText(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        org.mockito.Mockito.doThrow(new org.springframework.dao.DataIntegrityViolationException("Failing row contains (국물 민감한입력)"))
                .when(logs).append(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"text\":\"국물 민감한입력\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.tastes[0].label").value("국물"));
        for (int i = 0; i < 100 && !output.getAll().contains("DataIntegrityViolationException"); i++) Thread.sleep(10);
        org.junit.jupiter.api.Assertions.assertTrue(output.getAll().contains("DataIntegrityViolationException"));
        org.junit.jupiter.api.Assertions.assertFalse(output.getAll().contains("민감한입력"));
    }
    @Test @DisplayName("분석_출처 불일치_403")
    void analyze_wrongOrigin_returns403() throws Exception {
        mvc.perform(post("/api/v1/onboarding/taste-analysis").header("Origin", "https://other.example")
                .contentType("application/json").content("{\"text\":\"국물\"}"))
                .andExpect(status().isForbidden());
    }
    @Test @DisplayName("분석_31번째 요청_429")
    void analyze_thirtyFirstRequest_returns429() throws Exception {
        for (int i = 0; i < 31; i++) {
            mvc.perform(post("/api/v1/onboarding/taste-analysis").with(request -> { request.setRemoteAddr("203.0.113.31"); return request; })
                    .header("Origin", "http://localhost:3000").contentType("application/json").content("{\"text\":\"국물\"}"))
                    .andExpect(i < 30 ? status().isOk() : status().isTooManyRequests());
        }
    }
}
