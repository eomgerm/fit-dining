package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import java.time.*;
import java.util.*;
import java.util.stream.Stream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.infrastructure.*;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

class SocialInfrastructureTests {
    @Test void kakaoEmailScopeIsOptInAndLegacyCookiesRemainStrictlyValidated() {
        for (String value : List.of("false", "true")) {
            var provider = new SocialProviders(environment().withProperty("AUTH_KAKAO_EMAIL_SCOPE_ENABLED", value)).get("kakao");
            assertEquals(value.equals("true") ? "account_email" : null, provider.scope());
        }
        assertNull(new SocialProviders(environment()).get("kakao").scope());
        Clock clock = Clock.systemUTC();
        var tokens = new SocialTokens(new NimbusTokenCodec(new byte[32], clock), clock);
        String legacy = tokens.encode("social_signup", "kakao", "subject");
        assertArrayEquals(new String[]{"kakao", "subject", ""}, tokens.decode(legacy, "social_signup", 3));
        assertThrows(AuthFailure.class, () -> tokens.decode(legacy + "x", "social_signup", 3));
        assertThrows(AuthFailure.class, () -> tokens.decode(tokens.encode("social_signup", "kakao"), "social_signup", 3));
        assertThrows(AuthFailure.class, () -> tokens.decode(tokens.encode("social_signup", "kakao", "subject", "", "extra"), "social_signup", 3));
        assertThrows(AuthFailure.class, () -> tokens.decode(tokens.encode("oauth_state", "kakao", "subject"), "social_signup", 3));
        var expired = new SocialTokens(new NimbusTokenCodec(new byte[32], Clock.offset(clock, Duration.ofMinutes(11))), clock);
        assertThrows(AuthFailure.class, () -> expired.decode(legacy, "social_signup", 3));
    }

    @Test
    void providerEmailsRequireTrustedFlagsAndValidFormat() {
        var providers = new SocialProviders(environment());
        var google = providers.get("google");
        assertEquals("openid email", google.scope());
        assertEquals("person@example.com", google.email(Map.of("email", " Person@Example.com ", "email_verified", true)));
        assertNull(google.email(Map.of("email", "person@example.com", "email_verified", false)));
        assertNull(google.email(Map.of("email", "person@example.com")));
        assertNull(google.email(Map.of("email", "invalid", "email_verified", true)));
        var kakao = providers.get("kakao");
        assertNull(kakao.scope());
        assertEquals("person@example.com", kakao.email(Map.of("kakao_account", Map.of(
                "email", "Person@Example.com", "is_email_valid", true, "is_email_verified", true))));
        for (boolean valid : List.of(true, false)) for (boolean verified : List.of(true, false)) {
            if (valid && verified) continue;
            assertNull(kakao.email(Map.of("kakao_account", Map.of(
                    "email", "person@example.com", "is_email_valid", valid, "is_email_verified", verified))));
        }
        assertNull(kakao.email(Map.of()));
        var naver = providers.get("naver");
        assertEquals("person@example.com", naver.email(Map.of("response", Map.of("email", "Person@Example.com"))));
        assertNull(naver.email(Map.of("response", Map.of())));
        assertNull(naver.email(Map.of("response", Map.of("email", "invalid"))));
    }

    MockEnvironment environment() {
        var env = new MockEnvironment();
        for (String provider : List.of("GOOGLE", "KAKAO", "NAVER")) {
            env.withProperty("AUTH_" + provider + "_CLIENT_ID", "id").withProperty("AUTH_" + provider + "_CLIENT_SECRET", "secret");
        }

        return env;
    }

    @Test
    @DisplayName("제공자_키 누락과 한쪽 설정_비활성 및 기동 거부")
    void providers_missingAndPartialCredentials_disableOrReject() {
        assertThrows(IllegalArgumentException.class, () -> new SocialProviders(new MockEnvironment()).get("google"));
        assertThrows(IllegalArgumentException.class, () -> new SocialProviders(new MockEnvironment().withProperty("AUTH_KAKAO_CLIENT_ID", "id")));
        assertThrows(IllegalArgumentException.class, () -> new SocialProviders(new MockEnvironment().withProperty("AUTH_NAVER_CLIENT_SECRET", "secret")));
        assertFalse(new SocialProviders(environment()).get("google").toString().contains("secret"));
    }

    @Test
    @DisplayName("서명쿠키_위조 만료와 타입 혼동_인증 거부")
    void tokens_tamperedExpiredAndWrongType_reject() {
        Clock clock = Clock.fixed(Instant.parse("2026-10-26T00:00:00Z"), ZoneOffset.UTC);
        var codec = new NimbusTokenCodec(new byte[32], clock);
        var tokens = new SocialTokens(codec, clock);
        String token = tokens.encode("oauth_state", "google", "state", "verifier", "signup");
        assertArrayEquals(new String[]{
            "google", "state", "verifier", "signup"
        }, tokens.decode(token, "oauth_state", 4));
        assertThrows(AuthFailure.class, () -> tokens.decode(token + "x", "oauth_state", 4));
        assertThrows(AuthFailure.class, () -> codec.decode(token, "access"));
        assertThrows(AuthFailure.class, () -> tokens.decode(token, "social_signup", 2));
        var later = new SocialTokens(new NimbusTokenCodec(new byte[32], Clock.offset(clock, Duration.ofSeconds(600))), clock);
        assertThrows(AuthFailure.class, () -> later.decode(token, "oauth_state", 4));
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"oauth_state,iss", "oauth_state,aud", "oauth_state,iat",
        "social_signup,iss", "social_signup,aud", "social_signup,iat"})
    void signedCookiesRejectWrongIssuerAudienceAndFutureIssuedAt(String type, String field) throws Exception {
        Clock clock = Clock.fixed(Instant.parse("2026-10-26T00:00:00Z"), ZoneOffset.UTC);
        var tokens = new SocialTokens(new NimbusTokenCodec(new byte[32], clock), clock);
        String token = type.equals("oauth_state") ? tokens.encode(type, "google", "state", "verifier", "login")
            : tokens.encode(type, "google", "subject");
        var parsed = com.nimbusds.jwt.SignedJWT.parse(token);
        var claims = new com.nimbusds.jwt.JWTClaimsSet.Builder(parsed.getJWTClaimsSet());
        switch (field) {
            case "iss" -> claims.issuer("other");
            case "aud" -> claims.audience("other");
            case "iat" -> claims.issueTime(Date.from(clock.instant().plusSeconds(1)));
            default -> throw new AssertionError(field);
        }
        var signed = new com.nimbusds.jwt.SignedJWT(parsed.getHeader(), claims.build());
        signed.sign(new com.nimbusds.jose.crypto.MACSigner(new byte[32]));
        assertThrows(AuthFailure.class, () -> tokens.decode(signed.serialize(), type, type.equals("oauth_state") ? 4 : 2));
    }

    static Stream<Arguments> profiles() {
        return Stream.of(
            Arguments.of("google", "{\"sub\":\"g-id\"}", "g-id"),
            Arguments.of("kakao", "{\"id\":1234567890123}", "1234567890123"),
            Arguments.of("naver", "{\"response\":{\"id\":\"n-id\"}}", "n-id"));
    }

    @ParameterizedTest
    @MethodSource("profiles")
    @DisplayName("제공자_코드 교환과 정보 조회_식별자만 추출")
    void exchange_eachProvider_extractsIdentity(String name, String profile, String expected) {
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        var provider = new SocialProviders(environment()).get(name);
        server.expect(requestTo(provider.token())).andExpect(method(HttpMethod.POST))
            .andExpect(content().string(Matchers.containsString("client_secret=secret")))
            .andExpect(content().string(Matchers.containsString(provider.pkce() ? "code_verifier=verifier" : "state=state")))
            .andRespond(withSuccess("{\"access_token\":\"provider-token\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(provider.userinfo())).andExpect(header("Authorization", "Bearer provider-token"))
            .andRespond(withSuccess(profile, MediaType.APPLICATION_JSON));
        assertEquals(expected, new SocialProviderClient(builder.build()).exchange(provider, "code", "state", "verifier", "http://localhost/callback").subject());
        server.verify();
    }

    @ParameterizedTest
    @ValueSource(booleans = {
        false, true
    })
    @DisplayName("제공자_토큰과 사용자 정보 HTTP 실패_교환 거부")
    void exchange_httpFailure_rejects(boolean profileFailure) {
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        var provider = new SocialProviders(environment()).get("google");
        if (profileFailure) {
            server.expect(requestTo(provider.token())).andRespond(withSuccess("{\"access_token\":\"token\"}", MediaType.APPLICATION_JSON));
            server.expect(requestTo(provider.userinfo())).andRespond(withServerError());
        } else server.expect(requestTo(provider.token())).andRespond(withBadRequest());
        assertThrows(RestClientResponseException.class,
            () -> new SocialProviderClient(builder.build()).exchange(provider, "code", "state", "verifier", "http://localhost/callback").subject());
        server.verify();
    }

    @Test
    @DisplayName("네이버_토큰 교환_state를 보내고 PKCE verifier는 보내지 않음")
    void exchange_naver_sendsStateWithoutVerifier() {
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        var provider = new SocialProviders(environment()).get("naver");
        server.expect(requestTo(provider.token()))
            .andExpect(content().string(Matchers.containsString("state=naver-state")))
            .andExpect(content().string(Matchers.not(Matchers.containsString("code_verifier"))))
            .andRespond(withSuccess("{\"access_token\":\"provider-token\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(provider.userinfo()))
            .andRespond(withSuccess("{\"response\":{\"id\":\"naver-id\"}}", MediaType.APPLICATION_JSON));
        assertEquals("naver-id", new SocialProviderClient(builder.build()).exchange(
            provider, "code", "naver-state", "unused-verifier", "http://localhost/callback").subject());
        server.verify();
    }
}
