package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import kr.co.fitdining.api.auth.application.EmailVerifications;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.EmailVerificationFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.ports.PasswordHasher;
import kr.co.fitdining.api.auth.ports.VerificationMailer;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import tools.jackson.databind.json.JsonMapper;

// 컨텍스트가 하나 더 늘어 공용 시험 DB 연결을 아끼려고 풀을 줄인다(TasteProfileSignupTests와 같은 방식).
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.datasource.hikari.maximum-pool-size=3")
@Import(EmailVerificationTests.Configuration.class)
// 이 클래스만 쓰는 컨텍스트라 끝나면 닫아 공용 시험 DB 연결을 돌려준다.
@org.springframework.test.annotation.DirtiesContext
class EmailVerificationTests extends PostgresTestSupport {
    @Autowired EmailVerifications verifications;
    @Autowired AuthUseCases auth;
    @Autowired RecordingMailer mailer;
    @Autowired MutableClock clock;
    @Autowired GatedHasher passwords;
    @Value("${local.server.port}") int port;
    final HttpClient client = HttpClient.newHttpClient();
    final JsonMapper mapper = JsonMapper.builder().build();
    JdbcTemplate jdbc;

    @BeforeEach void setup() {
        clock.instant = Instant.parse("2026-11-03T00:00:00Z");
        mailer.codes.clear();
        mailer.fail = false;
        passwords.entered = null;
        passwords.release = null;
        jdbc = new JdbcTemplate(appSource());
    }

    String email() { return "v" + UUID.randomUUID().toString().substring(0, 12) + "@example.com"; }
    String address() { return "addr-" + UUID.randomUUID(); }
    String nickname() { return "n" + UUID.randomUUID().toString().substring(0, 10); }

    String verify(String email) {
        verifications.request(email, address());
        return verifications.confirm(email, mailer.codes.get(email), address()).verificationToken();
    }

    AuthFailure failure(org.junit.jupiter.api.function.Executable work) { return assertThrows(AuthFailure.class, work); }

    int users(String email) {
        return jdbc.queryForObject("select count(*) from auth_users where email = ?", Integer.class, email);
    }

    @Test @DisplayName("이메일 인증_요청 확인 가입_계정 생성과 인증 시각 기록")
    void verification_requestConfirmSignup_createsVerifiedAccount() {
        String email = email();
        var requested = verifications.request(" " + email.toUpperCase() + " ", address());
        assertEquals(clock.instant().plusSeconds(600), requested.expiresAt());
        assertEquals(clock.instant().plusSeconds(60), requested.resendAvailableAt());
        String code = mailer.codes.get(email);
        assertTrue(code.matches("[0-9]{6}"));
        var confirmed = verifications.confirm(email, code, address());
        assertEquals(clock.instant().plusSeconds(1800), confirmed.expiresAt());
        auth.signup(email, "password1", nickname(), confirmed.verificationToken(), address());
        assertEquals(clock.instant(), jdbc.queryForObject("select email_verified_at from auth_users where email = ?",
                java.sql.Timestamp.class, email).toInstant());
        assertNotNull(jdbc.queryForObject("select consumed_at from auth_email_verifications where email = ?",
                java.sql.Timestamp.class, email));
    }

    @Test @DisplayName("이메일 인증_원문 저장 없음_해시만 저장")
    void verification_storage_keepsOnlyHashes() {
        String email = email();
        verifications.request(email, address());
        String code = mailer.codes.get(email);
        String token = verifications.confirm(email, code, address()).verificationToken();
        String row = jdbc.queryForObject("select row_to_json(v)::text from auth_email_verifications v where email = ?", String.class, email);
        assertFalse(row.contains("\"" + code + "\""));
        assertFalse(row.contains(token));
    }

    @Test @DisplayName("가입_인증 토큰 없음_400 verification-required와 계정 미생성")
    void signup_missingToken_rejectsWithoutAccount() {
        String email = email();
        for (String token : new String[]{null, "", "unknown-token"}) {
            var failure = failure(() -> auth.signup(email, "password1", nickname(), token, address()));
            assertEquals(400, failure.status());
            assertEquals(EmailVerificationFailure.REQUIRED, failure.type());
        }
        assertEquals(0, users(email));
    }

    @Test @DisplayName("가입_만료된 인증 토큰_400과 계정 미생성")
    void signup_expiredToken_rejectsWithoutAccount() {
        String email = email();
        String token = verify(email);
        clock.advance(1800);
        assertEquals(EmailVerificationFailure.REQUIRED,
                failure(() -> auth.signup(email, "password1", nickname(), token, address())).type());
        assertEquals(0, users(email));
    }

    @Test @DisplayName("가입_다른 이메일의 인증 토큰_400과 계정 미생성")
    void signup_tokenForOtherEmail_rejectsWithoutAccount() {
        String token = verify(email());
        String other = email();
        assertEquals(EmailVerificationFailure.REQUIRED,
                failure(() -> auth.signup(other, "password1", nickname(), token, address())).type());
        assertEquals(0, users(other));
    }

    @Test @DisplayName("가입_사용한 인증 토큰 재사용_400과 계정 미생성")
    void signup_reusedToken_rejects() {
        String email = email();
        String token = verify(email);
        String user = auth.signup(email, "password1", nickname(), token, address()).identity().userId();
        jdbc.update("update auth_users set deleted_at = ? where id = ?", java.sql.Timestamp.from(clock.instant()), user);
        assertEquals(EmailVerificationFailure.REQUIRED,
                failure(() -> auth.signup(email, "password1", nickname(), token, address())).type());
        // 탈퇴한 계정 한 건만 남고 새 계정은 만들지 않는다.
        assertEquals(1, users(email));
    }

    @Test @DisplayName("가입_같은 인증 토큰 동시 사용_한 건만 성공")
    void signup_concurrentSameToken_onlyOneSucceeds() throws Exception {
        String email = email();
        String token = verify(email);
        // 두 요청이 모두 사전 검사를 통과한 뒤 트랜잭션에 들어가게 비밀번호 해시에서 맞춘다.
        passwords.entered = new CountDownLatch(2);
        passwords.release = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Callable<Object> work = () -> {
                try { auth.signup(email, "password1", nickname(), token, address()); return 201; }
                catch (AuthFailure failure) { return failure.type(); }
            };
            var a = executor.submit(work);
            var b = executor.submit(work);
            try { assertTrue(passwords.entered.await(5, TimeUnit.SECONDS)); }
            finally { passwords.release.countDown(); }
            var results = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertTrue(results.contains(201));
            assertTrue(results.contains(EmailVerificationFailure.REQUIRED), results.toString());
            assertEquals(1, users(email));
        } finally { passwords.entered = null; passwords.release = null; }
    }

    @Test @DisplayName("인증번호 확인_틀린 번호 5회_이후 정답도 거절")
    void confirm_fiveWrongCodes_rejectsCorrectCode() {
        String email = email();
        verifications.request(email, address());
        String code = mailer.codes.get(email);
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 4; i++) {
            assertEquals(EmailVerificationFailure.CODE_MISMATCH, failure(() -> verifications.confirm(email, wrong, address())).type());
        }
        var fifth = failure(() -> verifications.confirm(email, wrong, address()));
        assertEquals(429, fifth.status());
        assertEquals(EmailVerificationFailure.ATTEMPTS_EXCEEDED, fifth.type());
        assertEquals(EmailVerificationFailure.ATTEMPTS_EXCEEDED, failure(() -> verifications.confirm(email, code, address())).type());
    }

    @Test @DisplayName("인증번호 확인_10분 경과_만료")
    void confirm_expiredCode_rejects() {
        String email = email();
        verifications.request(email, address());
        clock.advance(600);
        assertEquals(EmailVerificationFailure.EXPIRED,
                failure(() -> verifications.confirm(email, mailer.codes.get(email), address())).type());
    }

    @Test @DisplayName("인증번호 요청_다시 받기_이전 번호 무효")
    void request_resend_invalidatesPreviousCode() {
        String email = email();
        verifications.request(email, address());
        String first = mailer.codes.get(email);
        clock.advance(60);
        verifications.request(email, address());
        String second = mailer.codes.get(email);
        if (!first.equals(second)) {
            assertEquals(EmailVerificationFailure.CODE_MISMATCH, failure(() -> verifications.confirm(email, first, address())).type());
        }
        assertNotNull(verifications.confirm(email, second, address()).verificationToken());
        assertEquals(EmailVerificationFailure.EXPIRED, failure(() -> verifications.confirm(email, second, address())).type());
    }

    @Test @DisplayName("인증번호 요청_60초 안에 다시 요청_429와 남은 시간")
    void request_withinResendWait_isLimited() {
        String email = email();
        verifications.request(email, address());
        clock.advance(30);
        var failure = failure(() -> verifications.request(email, address()));
        assertEquals(429, failure.status());
        assertEquals(31, failure.retryAfterSeconds());
    }

    @Test @DisplayName("인증번호 요청_이메일별 1시간 5회 초과_429")
    void request_overEmailHourlyLimit_isLimited() {
        String email = email();
        for (int i = 0; i < 5; i++) {
            verifications.request(email, address());
            clock.advance(60);
        }
        assertEquals(429, failure(() -> verifications.request(email, address())).status());
        clock.advance(3600);
        assertNotNull(verifications.request(email, address()));
    }

    @Test @DisplayName("인증번호 요청_주소별 15분 10회 초과_429")
    void request_overAddressLimit_isLimited() {
        String address = address();
        for (int i = 0; i < 10; i++) verifications.request(email(), address);
        assertEquals(429, failure(() -> verifications.request(email(), address)).status());
        assertNotNull(verifications.request(email(), address()));
    }

    @Test @DisplayName("인증번호 요청_이미 가입한 이메일_409 email-taken과 메일 없음")
    void request_existingAccount_returnsConflict() {
        String email = email();
        auth.signup(email, "password1", nickname(), verify(email), address());
        mailer.codes.clear();
        var failure = failure(() -> verifications.request(email, address()));
        assertEquals(409, failure.status());
        assertEquals("urn:fitdining:auth:email-taken", failure.type().toString());
        assertTrue(mailer.codes.isEmpty());
    }

    @Test @DisplayName("인증번호 요청_메일 발송 실패_503과 바로 재요청 가능")
    void request_mailFailure_returnsUnavailableAndAllowsRetry() {
        String email = email();
        mailer.fail = true;
        var failure = failure(() -> verifications.request(email, address()));
        assertEquals(503, failure.status());
        assertEquals(EmailVerificationFailure.MAIL_UNAVAILABLE, failure.type());
        assertEquals(0, jdbc.queryForObject("select count(*) from auth_email_verifications where email = ?", Integer.class, email));
        mailer.fail = false;
        assertNotNull(verifications.request(email, address()));
    }

    @Test @DisplayName("이메일 인증 HTTP_요청 확인 가입_202 200 201")
    void http_requestConfirmSignup_succeeds() throws Exception {
        String email = email();
        var requested = post("/api/auth/email-verifications", "{\"email\":\"" + email + "\"}", "http://localhost:3000");
        assertEquals(202, requested.statusCode(), requested.body());
        var body = mapper.readTree(requested.body());
        assertEquals("2026-11-03T00:10:00Z", body.get("expiresAt").asString());
        assertEquals("2026-11-03T00:01:00Z", body.get("resendAvailableAt").asString());
        var wrong = post("/api/auth/email-verifications/confirm",
                "{\"email\":\"" + email + "\",\"code\":\"12345\"}", "http://localhost:3000");
        assertEquals(400, wrong.statusCode());
        assertEquals("code", mapper.readTree(wrong.body()).get("errors").get(0).get("field").asString());
        var confirmed = post("/api/auth/email-verifications/confirm",
                "{\"email\":\"" + email + "\",\"code\":\"" + mailer.codes.get(email) + "\"}", "http://localhost:3000");
        assertEquals(200, confirmed.statusCode(), confirmed.body());
        String token = mapper.readTree(confirmed.body()).get("verificationToken").asString();
        var signup = post("/api/auth/signup", """
                {"email":"%s","password":"password1","nickname":"%s","verificationToken":"%s",
                 "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                """.formatted(email, nickname(), token), "http://localhost:3000");
        assertEquals(201, signup.statusCode(), signup.body());
    }

    @Test @DisplayName("이메일 인증 HTTP_다른 Origin과 잘못된 형식_403과 400")
    void http_untrustedOriginAndInvalidEmail_rejected() throws Exception {
        assertEquals(403, post("/api/auth/email-verifications", "{\"email\":\"a@example.com\"}", "https://evil.example").statusCode());
        var invalid = post("/api/auth/email-verifications", "{\"email\":\"invalid\"}", "http://localhost:3000");
        assertEquals(400, invalid.statusCode());
        assertEquals("email", mapper.readTree(invalid.body()).get("errors").get(0).get("field").asString());
        assertTrue(mailer.codes.isEmpty());
    }

    @Test @DisplayName("가입 HTTP_인증 토큰 없음_400 verification-required")
    void http_signupWithoutToken_returnsVerificationRequired() throws Exception {
        var response = post("/api/auth/signup", """
                {"email":"%s","password":"password1","nickname":"%s",
                 "agreements":{"ageOver14":true,"terms":true,"privacy":true}}
                """.formatted(email(), nickname()), "http://localhost:3000");
        assertEquals(400, response.statusCode());
        assertEquals(EmailVerificationFailure.REQUIRED.toString(), mapper.readTree(response.body()).get("type").asString());
    }

    @Test @DisplayName("이메일 인증 HTTP_재발송 대기_Retry-After 남은 초")
    void http_resendWait_returnsRetryAfter() throws Exception {
        String email = email();
        assertEquals(202, post("/api/auth/email-verifications", "{\"email\":\"" + email + "\"}", "http://localhost:3000").statusCode());
        var limited = post("/api/auth/email-verifications", "{\"email\":\"" + email + "\"}", "http://localhost:3000");
        assertEquals(429, limited.statusCode());
        assertEquals("61", limited.headers().firstValue("Retry-After").orElseThrow());
    }

    HttpResponse<String> post(String path, String body, String origin) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
        if (origin != null) builder.header("Origin", origin);
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    @TestConfiguration
    static class Configuration {
        @Bean @Primary RecordingMailer recordingMailer() { return new RecordingMailer(); }
        @Bean @Primary MutableClock verificationClock() { return new MutableClock(); }
        @Bean @Primary GatedHasher gatedHasher() { return new GatedHasher(); }
    }

    /** 테스트 전용 발송기. 마지막으로 보낸 인증번호를 이메일별로 기억한다. */
    static final class RecordingMailer implements VerificationMailer {
        final Map<String, String> codes = new ConcurrentHashMap<>();
        volatile boolean fail;
        @Override public void sendVerificationCode(String email, String code) {
            if (fail) throw new MailUnavailable(new IllegalStateException("smtp down"));
            codes.put(email, code);
        }
    }

    static final class MutableClock extends Clock {
        volatile Instant instant = Instant.parse("2026-11-03T00:00:00Z");
        void advance(long seconds) { instant = instant.plusSeconds(seconds); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return instant; }
    }

    static final class GatedHasher implements PasswordHasher {
        final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
        volatile CountDownLatch entered;
        volatile CountDownLatch release;
        @Override public String hash(String password) {
            if (entered != null) {
                entered.countDown();
                try { assertTrue(release.await(8, TimeUnit.SECONDS)); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
            }
            return encoder.encode(password);
        }
        @Override public boolean matches(String password, String hash) { return encoder.matches(password, hash); }
    }
}
