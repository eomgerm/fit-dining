package kr.co.fitdining.api.auth.infrastructure;

import static org.assertj.core.api.Assertions.*;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.jackson.SecurityJacksonModules;
import org.springframework.session.MapSession;
import org.springframework.session.web.http.CookieSerializer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.jsontype.BasicPolymorphicTypeValidator;

class SessionInfrastructureTests {
    record TestPrincipal(long userId) { }

    @Test
    void securityContextAndExactPrincipalAllowList() {
        var mapper = JsonMapper.builder().addModules(SecurityJacksonModules.getModules(getClass().getClassLoader(),
                BasicPolymorphicTypeValidator.builder().allowIfSubType(TestPrincipal.class))).build();
        var context = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(
                new TestPrincipal(42), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        var json = mapper.writeValueAsBytes(context);
        assertThat(mapper.readValue(json, Object.class)).isEqualTo(context);
        assertThatThrownBy(() -> SessionConfiguration.sessionMapper().readValue(json, Object.class))
                .isInstanceOf(Exception.class);
    }

    @Test
    void jsonSerializerRoundTripsSecurityContextAndSimpleAttributes() {
        var serializer = new SessionConfiguration().springSessionDefaultRedisSerializer();
        var context = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(
                "user", null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        assertThat(serializer.deserialize(serializer.serialize(context))).isEqualTo(context);
        assertThat(serializer.deserialize(serializer.serialize("value"))).isEqualTo("value");
        assertThat(serializer.deserialize(serializer.serialize(42L))).isEqualTo(42L);
        for (Number value : List.<Number>of(42, 42L, (short) 42, (byte) 42, 1.5d, 1.5f,
                new java.math.BigInteger("42"), new java.math.BigDecimal("1.50"))) {
            assertThat(serializer.deserialize(serializer.serialize(value))).isEqualTo(value).isExactlyInstanceOf(value.getClass());
        }
    }

    @Test
    void productionIdentityRoundTripsAndIndexesByUserId() {
        var identity = new kr.co.fitdining.api.auth.ports.AuthUseCases.Identity("user-42", "name", 200);
        var context = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(identity, null, List.of()));
        var serializer = new SessionConfiguration().springSessionDefaultRedisSerializer();
        var restored = (SecurityContextImpl) serializer.deserialize(serializer.serialize(context));
        assertThat(restored.getAuthentication().getName()).isEqualTo("user-42");
        assertThat(restored.getAuthentication().getPrincipal()).isEqualTo(identity);
    }

    @Test
    void legacyPrincipalFieldsAreIgnoredInSecurityContextJson() {
        var identity = new kr.co.fitdining.api.auth.ports.AuthUseCases.Identity("legacy-user", "name", 200);
        var context = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated(identity, null, List.of()));
        var serializer = new SessionConfiguration().springSessionDefaultRedisSerializer();
        String json = new String(serializer.serialize(context), java.nio.charset.StandardCharsets.UTF_8)
            .replace("\"sessionExpiresAt\":200", "\"sessionId\":\"old-family\",\"accessExpiresAt\":100,\"sessionExpiresAt\":200");
        assertThat(json).contains("old-family");
        var restored = (SecurityContextImpl) serializer.deserialize(json.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(restored.getAuthentication().getPrincipal()).isEqualTo(identity);
    }

    @Test
    void changingSessionIdPreservesCreationTime() {
        var session = new MapSession();
        var created = session.getCreationTime();
        var oldId = session.getId();
        session.changeSessionId();
        assertThat(session.getId()).isNotEqualTo(oldId);
        assertThat(session.getCreationTime()).isEqualTo(created);
    }

    @Test
    void absoluteExpiryUsesCreationTimeAndNeverCreatesSessions() throws Exception {
        var request = new MockHttpServletRequest();
        var session = new MockHttpSession();
        request.setSession(session);
        long created = session.getCreationTime();
        var before = new AbsoluteSessionExpiryFilter(new StrictAuthPolicy(),
                Clock.fixed(Instant.ofEpochMilli(created + 86400000L - 1), ZoneOffset.UTC));
        before.doFilter(request, new MockHttpServletResponse(), (req, res) -> assertThat(session.isInvalid()).isFalse());
        var expired = new AbsoluteSessionExpiryFilter(new StrictAuthPolicy(),
                Clock.fixed(Instant.ofEpochMilli(created + 86400000L), ZoneOffset.UTC));
        expired.doFilter(request, new MockHttpServletResponse(), (req, res) -> assertThat(session.isInvalid()).isTrue());
        var anonymous = new MockHttpServletRequest();
        expired.doFilter(anonymous, new MockHttpServletResponse(), (req, res) -> { });
        assertThat(anonymous.getSession(false)).isNull();
        assertThat(new StrictAuthPolicy().sessionIdleSeconds()).isEqualTo(7200);
        assertThat(new SimpleAuthPolicy(true).sessionIdleSeconds()).isEqualTo(43200);
    }

    @Test
    void csrfCookieDoesNotCreateSession() {
        var request = new MockHttpServletRequest();
        var response = new MockHttpServletResponse();
        var repository = SessionCsrf.repository(true);
        repository.saveToken(repository.generateToken(request), request, response);
        assertThat(response.getHeader("Set-Cookie")).contains("XSRF-TOKEN=", "Secure", "Path=/")
                .doesNotContain("HttpOnly");
        assertThat(response.getCookie("XSRF-TOKEN").getAttribute("SameSite")).isEqualTo("Lax");
        assertThat(request.getSession(false)).isNull();
    }

    @Test
    void sessionCookieContractIncludesBase64AndConfiguredSecureFlag() {
        for (boolean secure : new boolean[] {false, true}) {
            var request = new MockHttpServletRequest();
            var response = new MockHttpServletResponse();
            new SessionConfiguration().cookieSerializer(secure).writeCookieValue(
                    new CookieSerializer.CookieValue(request, response, "session-id"));
            var header = response.getHeader("Set-Cookie");
            assertThat(header).contains("fitdining_session=c2Vzc2lvbi1pZA==", "HttpOnly", "SameSite=Lax", "Path=/");
            assertThat(header.contains("Secure")).isEqualTo(secure);
        }
    }
}
