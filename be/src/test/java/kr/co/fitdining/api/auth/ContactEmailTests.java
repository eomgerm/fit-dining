package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.servlet.http.Cookie;
import java.util.UUID;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.*;
import kr.co.fitdining.api.auth.infrastructure.SocialTokens;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.support.SessionTestSupport;
import kr.co.fitdining.api.user.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "place.mock.enabled=true")
class ContactEmailTests extends PostgresTestSupport {
    @Autowired MockMvc mvc;
    @Autowired SocialTokens tokens;
    @Autowired SocialAccounts social;
    @Autowired AuthUseCases auth;
    @Autowired AuthUserRepository users;
    @Autowired UserService profiles;
    @Autowired EmailVerifications verifications;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.session.FindByIndexNameSessionRepository<?> sessions;

    // Keep signup/send limits enabled while isolating these HTTP requests from other test classes.
    org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder post(String path) {
        return org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .with(request -> { request.setRemoteAddr("contact-" + UUID.randomUUID()); return request; });
    }

    String email() { return UUID.randomUUID() + "@example.com"; }
    String signupCookie(String email) { return tokens.encode("social_signup", "google", UUID.randomUUID().toString(), email); }
    String body(String extra) {
        return "{\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true,\"marketing\":true}" + extra + "}";
    }
    Cookie session(AuthUseCases.Identity identity) {
        String value = SessionTestSupport.persist(sessions, identity);
        return new Cookie("fitdining_session", value.substring("fitdining_session=".length()));
    }

    @Test void legacyCookieCanInspectAndSignupWithVerifiedContactEmail() throws Exception {
        String legacy = tokens.encode("social_signup", "google", UUID.randomUUID().toString());
        var cookie = new Cookie("fitdining_social", legacy);
        mvc.perform(get("/api/auth/social/signup").cookie(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").isEmpty());
        mvc.perform(post("/api/auth/social/signup").cookie(cookie).with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json").content(body("")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.type").value(EmailVerificationFailure.REQUIRED.toString()));
        String email = email();
        mvc.perform(post("/api/auth/social/signup").cookie(cookie).with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json")
                .content(body(",\"contactEmail\":\"" + email + "\",\"verificationToken\":\"" + verifiedToken(email) + "\"")))
                .andExpect(status().isCreated());
    }

    @Test void malformedContactEmailIsAFieldErrorBeforeVerification() throws Exception {
        mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf())
                .cookie(new Cookie("fitdining_social", signupCookie(""))).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body(",\"contactEmail\":\"abc\"")))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.errors[0].field").value("contactEmail"));
    }

    @Test void userBodyValidationAndReadErrorsUseProblemDetails() throws Exception {
        var identity = social.signup("naver", UUID.randomUUID().toString(), null, email(), null, false).identity();
        String base = "/api/v1/users/" + identity.userId();
        String[][] cases = {{"/contact-email", "{\"email\":\"abc\"}", "email"},
                {"/marketing-consent", "{}", "agreed"}, {"/marketing-consent", "{\"agreed\":{}}", "agreed"},
                {"/contact-email", "", "body"}, {"/marketing-consent", "{", "body"}};
        for (var item : cases) {
            mvc.perform(put(base + item[0]).cookie(session(identity)).with(SessionTestSupport.csrf())
                    .header("Origin", "http://localhost:3000").contentType("application/json").content(item[1]))
                    .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.errors[0].field").value(item[2]))
                    .andExpect(jsonPath("$.errors[0].reason").isString());
        }
        mvc.perform(put("/api/v1/users/other/marketing-consent").cookie(session(identity)).with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json").content("{\"agreed\":true}"))
                .andExpect(status().isForbidden());
    }

    @Test void emailProfileDefaultsMarketingAndVerificationPurposeIsValidatedOverHttp() throws Exception {
        String email = email();
        String nickname = "m" + UUID.randomUUID().toString().substring(0, 10);
        String signup = mvc.perform(post("/api/auth/signup").with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json")
                .content("{\"email\":\"" + email + "\",\"nickname\":\"" + nickname + "\",\"password\":\"password123\","
                        + "\"verificationToken\":\"" + verifiedToken(email) + "\","
                        + "\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String userId = tools.jackson.databind.json.JsonMapper.builder().build().readTree(signup).get("userId").asString();
        var identity = new AuthUseCases.Identity(userId, nickname, java.time.Instant.now().getEpochSecond() + 3600);
        assertNull(users.findById(identity.userId()).orElseThrow().getMarketingAgreedAt());
        mvc.perform(get("/api/v1/users/" + identity.userId()).cookie(session(identity))).andExpect(status().isOk())
                .andExpect(jsonPath("$.contactEmail").value(email)).andExpect(jsonPath("$.marketingAgreed").value(false));
        mvc.perform(post("/api/auth/email-verifications").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isConflict());
        jdbc.update("update auth_email_verifications set created_at=created_at-interval '61 seconds' where email=?", email);
        mvc.perform(post("/api/auth/email-verifications").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"email\":\"" + email + "\",\"purpose\":\"contact\"}"))
                .andExpect(status().isAccepted());
        mvc.perform(post("/api/auth/email-verifications").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content("{\"email\":\"" + email + "\",\"purpose\":\"invalid\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("purpose"))
                .andExpect(jsonPath("$.errors[0].reason").value("인증 목적은 signup 또는 contact여야 합니다."));
    }

    @Test void concurrentSocialSignupsConsumeSharedTokenOnlyOnce() throws Exception {
        String email = email(), token = verifiedToken(email);
        String payload = body(",\"contactEmail\":\"" + email + "\",\"verificationToken\":\"" + token + "\"");
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var gate = new java.util.concurrent.CountDownLatch(1);
            var results = new java.util.ArrayList<java.util.concurrent.Future<Integer>>();
            for (int i = 0; i < 2; i++) results.add(executor.submit(() -> {
                gate.await();
                return mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf())
                        .cookie(new Cookie("fitdining_social", signupCookie(""))).header("Origin", "http://localhost:3000")
                        .contentType("application/json").content(payload)).andReturn().getResponse().getStatus();
            }));
            gate.countDown();
            var statuses = new java.util.ArrayList<Integer>();
            for (var result : results) statuses.add(result.get(20, java.util.concurrent.TimeUnit.SECONDS));
            statuses.sort(Integer::compareTo);
            assertEquals(java.util.List.of(201, 400), statuses);
        }
        assertEquals(1, jdbc.queryForObject("select count(*) from auth_users where contact_email=?", Integer.class, email));
    }

    @Test void signupInfoRequiresValidCookieAndReturnsNullableEmail() throws Exception {
        mvc.perform(get("/api/auth/social/signup")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/social/signup").cookie(new Cookie("fitdining_social", "invalid")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/social/signup").cookie(new Cookie("fitdining_social", signupCookie(""))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.provider").value("google"))
                .andExpect(jsonPath("$.email").isEmpty());
        mvc.perform(get("/api/auth/social/signup").cookie(new Cookie("fitdining_social", signupCookie("provider@example.com"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.email").value("provider@example.com"));
    }

    @Test void socialSignupUsesProviderEmailAndStoresConsentWithoutLoginEmail() throws Exception {
        String email = email();
        String response = mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json").content(body(""))
                .cookie(new Cookie("fitdining_social", signupCookie(email))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = tools.jackson.databind.json.JsonMapper.builder().build().readTree(response).get("userId").asString();
        var user = users.findById(id).orElseThrow();
        assertNull(user.getEmail());
        assertEquals(email, user.getContactEmail());
        assertNotNull(user.getContactEmailVerifiedAt());
        assertNotNull(user.getMarketingAgreedAt());
    }

    @Test void socialSignupRequiresAddressBoundSingleUseTokenForChangedEmail() throws Exception {
        String email = email();
        String token = verifiedToken(email);
        String extra = ",\"contactEmail\":\"" + email + "\",\"verificationToken\":\"" + token + "\"";
        mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body(extra)).cookie(new Cookie("fitdining_social", signupCookie(""))))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(body(extra)).cookie(new Cookie("fitdining_social", signupCookie(""))))
                .andExpect(status().isBadRequest());
        for (String missing : new String[]{"", ",\"contactEmail\":\"changed@example.com\"",
                ",\"contactEmail\":\"other@example.com\",\"verificationToken\":\"" + verifiedToken(email()) + "\""}) {
            mvc.perform(post("/api/auth/social/signup").with(SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
                    .contentType("application/json").content(body(missing)).cookie(new Cookie("fitdining_social", signupCookie(""))))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.type").value(org.hamcrest.Matchers.containsString("verification-required")));
        }
    }

    @Test void emailSignupSetsContactAndOptionalMarketingAndPurposeContactAllowsExistingEmail() {
        String email = email();
        var identity = auth.signup(email, "password123", "m" + UUID.randomUUID().toString().substring(0, 10),
                verifiedToken(email), UUID.randomUUID().toString(), null, true).identity();
        var profile = profiles.profile(identity.userId(), identity);
        assertEquals(email, profile.contactEmail());
        assertTrue(profile.marketingAgreed());
        assertEquals(409, assertThrows(AuthFailure.class,
                () -> verifications.request(email, UUID.randomUUID().toString())).status());
        jdbc.update("update auth_email_verifications set created_at=created_at-interval '61 seconds' where email=?", email);
        assertNotNull(verifications.request(email, UUID.randomUUID().toString(), "contact"));
    }

    @Test void profileContactUpdateConsentOwnershipCsrfAndWithdrawal() throws Exception {
        var identity = social.signup("naver", UUID.randomUUID().toString(), null, email(), null, false).identity();
        Cookie cookie = session(identity);
        String url = "/api/v1/users/" + identity.userId();
        mvc.perform(get(url).cookie(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.contactEmail").isString()).andExpect(jsonPath("$.marketingAgreed").value(false));
        String email = email();
        String token = verifiedToken(email);
        String request = "{\"email\":\"" + email.toUpperCase() + "\",\"verificationToken\":\"" + token + "\"}";
        mvc.perform(put(url + "/contact-email").cookie(cookie).header("Origin", "http://localhost:3000")
                .contentType("application/json").content(request)).andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/users/other/contact-email").cookie(cookie).with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json").content(request))
                .andExpect(status().isForbidden());
        mvc.perform(put(url + "/contact-email").cookie(cookie).with(SessionTestSupport.csrf())
                .header("Origin", "http://localhost:3000").contentType("application/json").content(request))
                .andExpect(status().isNoContent());
        assertEquals(email, profiles.profile(identity.userId(), identity).contactEmail());
        assertEquals(400, assertThrows(AuthFailure.class,
                () -> profiles.contactEmail(identity.userId(), identity, email, token)).status());
        for (boolean agreed : new boolean[]{true, false, true}) {
            mvc.perform(put(url + "/marketing-consent").cookie(cookie).with(SessionTestSupport.csrf())
                    .header("Origin", "http://localhost:3000").contentType("application/json")
                    .content("{\"agreed\":" + agreed + "}")).andExpect(status().isNoContent());
            assertEquals(agreed, profiles.profile(identity.userId(), identity).marketingAgreed());
        }
        profiles.withdraw(identity.userId(), identity);
        var withdrawn = users.findById(identity.userId()).orElseThrow();
        assertNull(withdrawn.getContactEmail());
        assertNull(withdrawn.getContactEmailVerifiedAt());
        assertNull(withdrawn.getMarketingAgreedAt());
    }

    @Test void migrationBackfillsOnlyActiveEmailAccountsAndAllowsSharedContactEmails() throws Exception {
        assertEquals(3, jdbc.queryForObject("select count(*) from information_schema.columns where table_schema='public' "
                + "and table_name='auth_users' and column_name in ('contact_email','contact_email_verified_at','marketing_agreed_at')",
                Integer.class));
        try (var connection = appSource().getConnection(); var sql = connection.createStatement()) {
            connection.setAutoCommit(false);
            sql.execute("create temp table auth_users(email varchar(254), email_verified_at timestamptz, deleted_at timestamptz) on commit drop");
            sql.execute("insert into auth_users values ('a@example.com', now(), null), ('b@example.com', null, null), (null,null,null), ('deleted@example.com',now(),now())");
            String migration = new String(new org.springframework.core.io.ClassPathResource("db/migration/V27__contact_email_and_marketing.sql")
                    .getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            sql.execute(migration);
            try (var rows = sql.executeQuery("select count(*) from auth_users where contact_email is not null")) {
                assertTrue(rows.next()); assertEquals(2, rows.getInt(1));
            }
            try (var rows = sql.executeQuery("select count(*) from auth_users where contact_email='a@example.com' and contact_email_verified_at=email_verified_at")) {
                assertTrue(rows.next()); assertEquals(1, rows.getInt(1));
            }
            sql.execute("update auth_users set contact_email='shared@example.com'");
            connection.rollback();
        }
    }
}
