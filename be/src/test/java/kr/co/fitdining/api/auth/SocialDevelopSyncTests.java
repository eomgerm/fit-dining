package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.servlet.http.Cookie;
import java.util.UUID;
import kr.co.fitdining.api.auth.application.SocialAccounts;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.SocialProviderClient;
import kr.co.fitdining.api.auth.infrastructure.SocialTokens;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "place.mock.enabled=true",
    "AUTH_GOOGLE_CLIENT_ID=test-client", "AUTH_GOOGLE_CLIENT_SECRET=test-secret"
})
class SocialDevelopSyncTests extends PostgresTestSupport {
    @Autowired SocialAccounts accounts;
    @Autowired AuthUseCases auth;
    @Autowired SocialTokens tokens;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired org.springframework.session.FindByIndexNameSessionRepository<?> sessionRepository;
    private Cookie sessionCookie(String userId) {
        var identity = new AuthUseCases.Identity(userId, "name", java.time.Instant.now().getEpochSecond() + 86400);
        String value = kr.co.fitdining.api.support.SessionTestSupport.persist(sessionRepository, identity);
        return new Cookie("fitdining_session", value.substring("fitdining_session=".length()));
    }
    @MockitoBean SocialProviderClient client;

    @Test void existingCallbackPreservesStoredContactEmailAndConsent() throws Exception {
        String subject = UUID.randomUUID().toString();
        String user = accounts.signup("google", subject, null, "stored@example.com", null, true).identity().userId();
        var before = jdbc.queryForMap("select contact_email, contact_email_verified_at, marketing_agreed_at from auth_users where id=?", user);
        when(client.exchange(any(), any(), any(), any(), any()))
                .thenReturn(new SocialProviderClient.Profile(subject, "different@example.com"));
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
                .with(request -> { request.setRemoteAddr("existing-" + UUID.randomUUID()); return request; })
                .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
                .andExpect(status().isFound()).andExpect(header().string("Location", "/"));
        assertEquals(before, jdbc.queryForMap("select contact_email, contact_email_verified_at, marketing_agreed_at from auth_users where id=?", user));
        assertNull(jdbc.queryForObject("select email from auth_users where id=?", String.class, user));
    }

    @Test
    @DisplayName("소셜탈퇴_같은 식별자_새 계정으로 재가입")
    void withdraw_sameIdentity_createsNewAccount() throws Exception {
        String subject = UUID.randomUUID().toString();
        var old = accounts.signup("google", subject, null, "provider@example.com", null, false);
        String user = old.identity().userId();
        mvc.perform(delete("/api/v1/users/" + user).with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .cookie(sessionCookie(user)))
                .andExpect(status().isNoContent());
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_social_accounts where user_id=?", Integer.class, user));
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile(subject, "provider@example.com"));
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
                .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
                .andExpect(status().isFound()).andExpect(header().string("Location", "/signup/social"));
        var fresh = accounts.signup("google", subject, null, "provider@example.com", null, false);
        assertNotEquals(user, fresh.identity().userId());
        jdbc.update("update auth_users set contact_email=null, contact_email_verified_at=null where id=?", fresh.identity().userId());
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
                .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
                .andExpect(status().isFound()).andExpect(header().string("Location", "/"))
                .andExpect(cookie().exists("fitdining_session"));
        assertEquals(fresh.identity().userId(), accounts.existing("google", subject).identity().userId());
        assertEquals("provider@example.com", jdbc.queryForObject("select contact_email from auth_users where id=?", String.class, fresh.identity().userId()));
        assertNotNull(jdbc.queryForObject("select contact_email_verified_at from auth_users where id=?", java.sql.Timestamp.class, fresh.identity().userId()));
    }

    @Test
    @DisplayName("소셜콜백_탈퇴 계정 연결 잔존_로그인 거부")
    void existing_withdrawnLinkedUser_rejectsLogin() throws Exception {
        String subject = UUID.randomUUID().toString();
        var old = accounts.signup("google", subject, null, "provider@example.com", null, false);
        jdbc.update("update auth_users set deleted_at=current_timestamp where id=?", old.identity().userId());
        assertThrows(AuthFailure.class, () -> accounts.existing("google", subject));
        when(client.exchange(any(), any(), any(), any(), any())).thenReturn(new kr.co.fitdining.api.auth.infrastructure.SocialProviderClient.Profile(subject, "provider@example.com"));
        mvc.perform(get("/api/auth/oauth/google/callback").param("code", "code").param("state", "state")
                .cookie(new Cookie("fitdining_oauth", tokens.encode("oauth_state", "google", "state", "verifier", "login"))))
                .andExpect(status().isFound()).andExpect(header().string("Location", "/login?error=social"))
                .andExpect(cookie().doesNotExist("fitdining_rt"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    @DisplayName("소셜가입_취향 포함과 생략_선택 저장 및 userId 반환")
    void signup_optionalPreferences_persistsAndReturnsUserId(boolean include) throws Exception {
        String subject = UUID.randomUUID().toString();
        String nickname = "취향" + subject.substring(0, 8);
        String preferences = include ? ",\"preferences\":{\"mood\":\"QUIET\",\"priorities\":[\"SPACIOUS\"],\"purposes\":[\"SOLO\"],\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"국물\"}]}" : "";
        var response = mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body(nickname, preferences))
                .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", subject, "provider@example.com"))))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.userId").isNotEmpty())
                .andReturn().getResponse();
        String user = accounts.existing("google", subject).identity().userId();
        assertTrue(response.getContentAsString().contains(user));
        assertEquals(include ? 1 : 0, jdbc.queryForObject("select count(*) from user_preferences where user_id=?", Integer.class, user));
        if (include) {
            assertEquals("QUIET", jdbc.queryForObject("select mood from user_preferences where user_id=?", String.class, user));
            mvc.perform(delete("/api/v1/users/" + user).with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                    .cookie(sessionCookie(user)))
                    .andExpect(status().isNoContent());
            assertEquals(0, jdbc.queryForObject("select count(*) from user_preferences where user_id=?", Integer.class, user));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"{\"mood\":\"UNKNOWN\"}", "{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\" \"}]}"})
    @DisplayName("소셜가입_잘못된 취향_400 및 계정 생성 방지")
    void signup_invalidPreferences_rejectsBeforeCreation(String preferences) throws Exception {
        String subject = UUID.randomUUID().toString();
        mvc.perform(post("/api/auth/social/signup").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body("검증취향", ",\"preferences\":" + preferences))
                .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", subject, "provider@example.com"))))
                .andExpect(status().isBadRequest());
        assertNull(accounts.existing("google", subject));
    }

    private String body(String nickname, String preferences) {
        return "{\"nickname\":\"" + nickname + "\",\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}" + preferences + "}";
    }
}
