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
            List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "quiet", "QUIET"),
                    new Preferences.TasteChip(Preferences.Polarity.LIKE, "soup", null)));
    final float[] vector = new float[1024];
    final List<TasteFeature> features = List.of(new TasteFeature("QUIET", "axis", true, 1));

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void signup_callsOnceOutsideTransaction_andPersistsFeatures(boolean socialSignup) {
        when(ai.profile(answers)).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return features;
        });
        when(ai.vectors(List.of("soup"))).thenAnswer(call -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            return List.of(vector);
        });
        String user = signup(socialSignup);
        verify(ai).profile(answers);
        assertEquals(features, preferences.findById(user).orElseThrow().getFeatures());
        assertEquals("QUIET", preferences.findById(user).orElseThrow().getTastes().getFirst().code());
        var jdbc = new JdbcTemplate(appSource());
        assertEquals("QUIET", jdbc.queryForObject("select features->0->>'code' from user_preferences where user_id=?", String.class, user));
        assertEquals(1024, jdbc.queryForObject("select jsonb_array_length(tastes->1->'vector') from user_preferences where user_id=?", Integer.class, user));
        // 백필은 code 키가 있고 값이 null인 칩만 대상으로 삼는다
        assertEquals(true, jdbc.queryForObject("select jsonb_exists(tastes->1, 'code') and tastes->1->'code' = 'null'::jsonb from user_preferences where user_id=?", Boolean.class, user));
        assertEquals("null", jdbc.queryForObject("select coalesce(tastes->0->'vector', 'null'::jsonb)::text from user_preferences where user_id=?", String.class, user));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void signup_aiFailureStillCreatesAccountWithEmptyFeatures(boolean socialSignup) {
        when(ai.profile(answers)).thenThrow(new IllegalStateException("unavailable"));
        when(ai.vectors(List.of("soup"))).thenThrow(new IllegalStateException("unavailable"));
        String user = signup(socialSignup);
        verify(ai).profile(answers);
        assertEquals(List.of(), preferences.findById(user).orElseThrow().getFeatures());
        assertNull(preferences.findById(user).orElseThrow().getTastes().get(1).vector());
    }
    private String signup(boolean socialSignup) {
        String id = UUID.randomUUID().toString();
        return (socialSignup ? social.signup("google", id, answers)
                : auth.signup(id + "@example.com", "password123", id.substring(0, 10), verifiedToken(id + "@example.com"), id, answers)).identity().userId();
    }
}
