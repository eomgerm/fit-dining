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
@Import({SecurityConfiguration.class, AuthRefreshCookieWriter.class, PlaceService.class,
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
    @Test void sessionPrincipalReplacesBodyPreferencesInAiRequest() throws Exception {
        long now = System.currentTimeMillis() / 1000;
        var identity = new AuthUseCases.Identity("session-user", "name", "family", now + 1800, now + 86400);
        when(auth.login(any(), any(), any())).thenReturn(new AuthUseCases.Issued("at", "rt", identity));
        var result = mvc.perform(post("/api/auth/login").header("Origin", "http://localhost:3000")
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
        verify(auth, never()).authenticate(any());
    }
}
