package kr.co.fitdining.api.user;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.UUID;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.onboarding.AiTasteClient;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"fitdining.ai.profile-enabled=true", "spring.datasource.hikari.maximum-pool-size=2"})
class TasteProfileSignupTests extends PostgresTestSupport {
    @Autowired AuthService auth;
    @Autowired SocialAccounts social;
    @Autowired UserPreferencesRepository preferences;
    @MockitoBean AiTasteClient ai;
    final Preferences answers = new Preferences(Preferences.Mood.QUIET, null, null,
            List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "quiet", "QUIET")));
    final List<TasteFeature> features = List.of(new TasteFeature("QUIET", "axis", true, 1));

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void signup_callsOnceOutsideTransaction_andPersistsFeatures(boolean socialSignup) {
        when(ai.profile(answers)).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return features;
        });
        String user = signup(socialSignup);
        verify(ai).profile(answers);
        assertEquals(features, preferences.findById(user).orElseThrow().getFeatures());
        assertEquals("QUIET", preferences.findById(user).orElseThrow().getTastes().getFirst().code());
        var jdbc = new JdbcTemplate(appSource());
        assertEquals("QUIET", jdbc.queryForObject("select features->0->>'code' from user_preferences where user_id=?", String.class, user));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void signup_aiFailureStillCreatesAccountWithEmptyFeatures(boolean socialSignup) {
        when(ai.profile(answers)).thenThrow(new IllegalStateException("unavailable"));
        String user = signup(socialSignup);
        verify(ai).profile(answers);
        assertEquals(List.of(), preferences.findById(user).orElseThrow().getFeatures());
    }
    private String signup(boolean socialSignup) {
        String id = UUID.randomUUID().toString();
        return (socialSignup ? social.signup("google", id, answers)
                : auth.signup(id + "@example.com", "password123", id.substring(0, 10), id, answers)).identity().userId();
    }
}
