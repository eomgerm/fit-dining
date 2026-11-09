package kr.co.fitdining.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration;
import kr.co.fitdining.api.onboarding.OnboardingController;
import kr.co.fitdining.api.onboarding.TasteAnalysisService;
import kr.co.fitdining.api.ops.OpsController;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest(controllers = {OpsController.class, OnboardingController.class}, properties = {
        "app.version.sha=test", "app.version.built-at=test",
        "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000"})
@Import(kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class SecurityHttpTests {
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext context;
    @MockitoBean AuthUseCases auth;
    @MockitoBean TasteAnalysisService analysis;

    @Test
    void anonymousGet_preservesBodyAndHeaders_withoutSession() throws Exception {
        MvcResult result = mvc.perform(get("/healthz").secure(true))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"status\":\"UP\"}"))
                .andExpect(header().doesNotExist("Cache-Control"))
                .andExpect(header().doesNotExist("X-Content-Type-Options"))
                .andReturn();
        assertUnchangedSecurityResponse(result);
    }

    @Test
    void anonymousPost_withoutCsrf_preservesBodyAndInterceptorHeaders_withoutSession() throws Exception {
        when(analysis.analyze(anyString(), anyString())).thenReturn(List.of());
        MvcResult result = mvc.perform(post("/api/v1/onboarding/taste-analysis").secure(true)
                        .header("Origin", "http://localhost:3000")
                        .contentType("application/json").content("{\"text\":\"empty\"}"))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"tastes\":[]}"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andReturn();
        assertUnchangedSecurityResponse(result);
    }

    @Test
    void defaultLoginAndLogout_areNotProvided() throws Exception {
        assertUnchangedSecurityResponse(mvc.perform(get("/login"))
                .andExpect(status().isUnauthorized()).andReturn());
        assertUnchangedSecurityResponse(mvc.perform(post("/logout"))
                .andExpect(status().isUnauthorized()).andReturn());
    }

    @Test
    void sharedConfiguration_installsOneChain_withoutGeneratedUser(CapturedOutput output) {
        assertThat(context.getBeansOfType(SecurityFilterChain.class)).hasSize(1);
        assertThat(context.getBeansOfType(org.springframework.session.SessionRepository.class)).isEmpty();
        assertThat(context.getBeansOfType(InMemoryUserDetailsManager.class)).isEmpty();
        assertThatThrownBy(() -> context.getBean(UserDetailsService.class).loadUserByUsername("user"))
                .isInstanceOf(UsernameNotFoundException.class);
        assertThat(output.getAll()).doesNotContain("Using generated security password");
    }

    private static void assertUnchangedSecurityResponse(MvcResult result) {
        assertThat(result.getRequest().getSession(false)).isNull();
        assertThat(result.getResponse().getHeaders("Set-Cookie")).noneMatch(cookie -> cookie.startsWith("fitdining_session="));
        for (String header : List.of("X-Frame-Options", "Strict-Transport-Security", "X-XSS-Protection",
                "WWW-Authenticate", "Location", "Pragma", "Expires")) {
            assertThat(result.getResponse().getHeader(header)).as(header).isNull();
        }
    }
}
