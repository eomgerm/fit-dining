package kr.co.fitdining.api.place.engine;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import java.time.Clock;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.presentation.*;
import kr.co.fitdining.api.auth.infrastructure.SecurityConfiguration;
import kr.co.fitdining.api.place.*;
import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestClient;

/** Session -> controller -> production engine -> actual AI request serialization. */
@WebMvcTest(controllers = {AuthController.class, PlaceController.class}, properties = {
    "auth.cookie-secure=false", "auth.frontend-origin=http://localhost:3000", "place.mock.enabled=false"})
@Import({SecurityConfiguration.class, LegacyRefreshCookieExpiry.class, PlaceService.class,
    CatalogPlaceSearchEngine.class, SessionSearchHttpTests.Config.class})
@org.springframework.test.context.ActiveProfiles("session-search-test")
class SessionSearchHttpTests {
    @org.springframework.boot.test.context.TestConfiguration
    @Profile("session-search-test")
    static class Config {
        @Bean Clock clock() { return Clock.systemUTC(); }
        @Bean RestClient.Builder builder() { return RestClient.builder(); }
        @Bean MockRestServiceServer server(RestClient.Builder builder) { return MockRestServiceServer.bindTo(builder).build(); }
        @Bean AiSearchClient ai(RestClient.Builder builder, MockRestServiceServer server, Clock clock) {
            var rest = builder.build();
            return new AiSearchClient("http://ai.test", "", "", AiSearchClient.Timing.DEFAULT, clock,
                timeout -> rest, duration -> {});
        }
    }
    @Autowired MockMvc mvc;
    @Autowired MockRestServiceServer server;
    @MockitoBean AuthUseCases auth;
    @MockitoBean PlaceCatalog catalog;
    @MockitoBean PlaceKeywordSearch keywords;
    /** AI 가짜 서버는 컨텍스트의 bean 하나라 테스트마다 기대를 비운다 */
    @org.junit.jupiter.api.BeforeEach void resetAi() { server.reset(); }
    @Test void sessionPrincipalReplacesBodyPreferencesInAiRequest() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        var identity = new AuthUseCases.Identity("session-user", "name", now + 86400);
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued(identity));
        var result = mvc.perform(post("/api/auth/login").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content("{\"email\":\"a@example.com\",\"password\":\"password1\"}"))
            .andExpect(status().isOk()).andReturn();
        var session = (MockHttpSession) result.getRequest().getSession(false);
        var csrf = result.getResponse().getCookie("XSRF-TOKEN");
        server.expect(requestTo("http://ai.test/v1/search"))
            .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.content().json(
                "{\"query\":\"cafe\",\"userId\":\"session-user\"}", org.springframework.test.json.JsonCompareMode.STRICT))
            .andRespond(withSuccess("{\"items\":[],\"nearby\":false,\"conditions\":{}}", MediaType.APPLICATION_JSON));
        mvc.perform(post("/api/v1/places/search").session(session).cookie(csrf)
            .header("X-XSRF-TOKEN", csrf.getValue()).contentType("application/json")
            .content("{\"query\":\"cafe\",\"preferences\":{\"mood\":\"LIVELY\"}}"))
            .andExpect(status().isOk());
        server.verify();
    }

    static final String AREA = "{\"swLat\":37.49,\"swLng\":127.02,\"neLat\":37.51,\"neLng\":127.05}";
    static final String EMPTY_AI = "{\"items\":[],\"nearby\":true,\"conditions\":{}}";

    /** 로그인해 세션과 CSRF 쿠키를 받는다 */
    org.springframework.test.web.servlet.MvcResult login() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        var identity = new AuthUseCases.Identity("session-user", "name", now + 86400);
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued(identity));
        return mvc.perform(post("/api/auth/login").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).header("Origin", "http://localhost:3000")
            .contentType("application/json").content("{\"email\":\"a@example.com\",\"password\":\"password1\"}"))
            .andExpect(status().isOk()).andReturn();
    }

    @Test void guestNearbyAndRegionAreAllowedAndSendTasteProfile() throws Exception {
        server.expect(requestTo("http://ai.test/v1/search"))
            .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.content().json(
                "{\"query\":\"근처 맛집\",\"mapBounds\":" + AREA + ",\"rulesOnly\":true,"
                    + "\"tasteProfile\":{\"mood\":\"QUIET\",\"priorities\":[],\"purposes\":[],\"tastes\":[]}}",
                org.springframework.test.json.JsonCompareMode.STRICT))
            .andRespond(withSuccess(EMPTY_AI, MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://ai.test/v1/search"))
            .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.content().json(
                "{\"query\":\"pasta\",\"previousConditions\":{\"text\":\"t\"},\"mapBounds\":" + AREA
                    + ",\"mapFirst\":true,\"tasteProfile\":{\"mood\":\"QUIET\",\"priorities\":[],\"purposes\":[],"
                    + "\"tastes\":[]}}", org.springframework.test.json.JsonCompareMode.STRICT))
            .andRespond(withSuccess(EMPTY_AI, MediaType.APPLICATION_JSON));

        mvc.perform(post("/api/v1/places/nearby").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType("application/json")
            .content("{\"mapBounds\":" + AREA + ",\"preferences\":{\"mood\":\"QUIET\"}}"))
            .andExpect(status().isOk());
        mvc.perform(post("/api/v1/places/search/region").with(kr.co.fitdining.api.support.SessionTestSupport.csrf()).contentType("application/json")
            .content("{\"query\":\"pasta\",\"conditions\":{\"text\":\"t\"},\"mapBounds\":" + AREA
                + ",\"preferences\":{\"mood\":\"QUIET\"}}"))
            .andExpect(status().isOk());
        server.verify();
    }

    @Test void sessionPrincipalIsUserIdForNearbyAndRegion() throws Exception {
        var result = login();
        var session = (MockHttpSession) result.getRequest().getSession(false);
        var csrf = result.getResponse().getCookie("XSRF-TOKEN");
        for (int i = 0; i < 2; i++) {
            server.expect(requestTo("http://ai.test/v1/search"))
                .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath("$.userId")
                    .value("session-user"))
                .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath("$.tasteProfile")
                    .doesNotExist())
                .andRespond(withSuccess(EMPTY_AI, MediaType.APPLICATION_JSON));
        }

        mvc.perform(post("/api/v1/places/nearby").session(session).cookie(csrf)
            .header("X-XSRF-TOKEN", csrf.getValue()).contentType("application/json")
            .content("{\"mapBounds\":" + AREA + ",\"preferences\":{\"mood\":\"LIVELY\"}}"))
            .andExpect(status().isOk());
        mvc.perform(post("/api/v1/places/search/region").session(session).cookie(csrf)
            .header("X-XSRF-TOKEN", csrf.getValue()).contentType("application/json")
            .content("{\"query\":\"pasta\",\"mapBounds\":" + AREA + ",\"preferences\":{\"mood\":\"LIVELY\"}}"))
            .andExpect(status().isOk());
        server.verify();
    }

    @Test void sessionWithoutCsrfTokenIsForbiddenOnAreaRequests() throws Exception {
        var session = (MockHttpSession) login().getRequest().getSession(false);

        mvc.perform(post("/api/v1/places/nearby").session(session).contentType("application/json")
            .content("{\"mapBounds\":" + AREA + "}")).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/places/search/region").session(session).contentType("application/json")
            .content("{\"query\":\"pasta\",\"mapBounds\":" + AREA + "}")).andExpect(status().isForbidden());
        server.verify();
    }

    @Test void authorizationIsIgnoredOnAreaRequests() throws Exception {
        for (int i = 0; i < 2; i++) {
            server.expect(requestTo("http://ai.test/v1/search"))
                .andExpect(org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath("$.userId").doesNotExist())
                .andRespond(withSuccess(EMPTY_AI, MediaType.APPLICATION_JSON));
        }
        mvc.perform(post("/api/v1/places/nearby").with(kr.co.fitdining.api.support.SessionTestSupport.csrf())
            .header("Authorization", "Bearer token").contentType("application/json")
            .content("{\"mapBounds\":" + AREA + "}")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/places/search/region").with(kr.co.fitdining.api.support.SessionTestSupport.csrf())
            .header("Authorization", "Bearer bad").contentType("application/json")
            .content("{\"query\":\"pasta\",\"mapBounds\":" + AREA + "}")).andExpect(status().isOk());
        verifyNoInteractions(auth);
        server.verify();
    }
}
