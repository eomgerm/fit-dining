package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;
import jakarta.validation.Validation;
import java.net.SocketTimeoutException;
import java.util.List;
import kr.co.fitdining.api.user.Preferences;
import org.junit.jupiter.api.*;
import org.springframework.http.*;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AiTasteAnalyzerTests {
    RestClient.Builder builder;
    MockRestServiceServer server;
    AiTasteClient client;
    AiTasteAnalyzer analyzer;
    @BeforeEach void setup() {
        builder = RestClient.builder().baseUrl("http://ai.test");
        server = MockRestServiceServer.bindTo(builder).build();
        var rest = builder.build();
        client = new AiTasteClient(rest, rest, Validation.buildDefaultValidatorFactory().getValidator());
        analyzer = new AiTasteAnalyzer(client);
    }
    @AfterEach void verify() { server.verify(); }
    @Test void chips_preserveCodeAndLegacyNull() {
        server.expect(requestTo("http://ai.test/v1/taste/interpret")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("{\"text\":\"sample\"}"))
                .andRespond(withSuccess("""
                    {"tastes":[{"polarity":"DISLIKE","label":"spicy","code":"FOOD_SPICY"},
                    {"polarity":"LIKE","label":"soup"}],"model":"test"}
                    """, MediaType.APPLICATION_JSON));
        var result = analyzer.analyze("sample");
        assertEquals("FOOD_SPICY", result.tastes().get(0).code());
        assertNull(result.tastes().get(1).code());
        assertEquals("test", result.model());
    }
    @Test void empty_staysEmpty() {
        server.expect(anything()).andRespond(withSuccess("{\"tastes\":[],\"model\":\"test\"}", MediaType.APPLICATION_JSON));
        assertEquals(List.of(), analyzer.analyze("sample").tastes());
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"{}", "null", "{", "{\"tastes\":[null]}",
            "{\"tastes\":[{\"polarity\":\"UNKNOWN\",\"label\":\"x\"}]}",
            "{\"tastes\":[{\"polarity\":\"LIKE\",\"label\":\"x\",\"code\":\"bad-code\"}]}"})
    void malformed_fails(String body) {
        server.expect(anything()).andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
        assertThrows(RuntimeException.class, () -> analyzer.analyze("sample"));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {400, 503, 500})
    void httpFailure_throws(int status) {
        server.expect(anything()).andRespond(withStatus(HttpStatusCode.valueOf(status)));
        assertThrows(RuntimeException.class, () -> analyzer.analyze("sample"));
    }
    @Test void timeout_throws() {
        server.expect(anything()).andRespond(withException(new SocketTimeoutException("timeout")));
        assertThrows(RuntimeException.class, () -> analyzer.analyze("sample"));
    }
    @Test void profile_sendsOnlyContractFields() {
        server.expect(requestTo("http://ai.test/v1/taste/profile")).andExpect(content().json("""
                {"mood":"QUIET","priorities":[],"purposes":[],
                "tastes":[{"polarity":"LIKE","label":"quiet","code":"QUIET"}]}
                """, true)).andRespond(withSuccess("""
                {"features":[{"code":"QUIET","layer":"axis","like":true,"weight":1}]}
                """, MediaType.APPLICATION_JSON));
        var features = client.profile(new Preferences(Preferences.Mood.QUIET, null, null,
                List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "quiet", "QUIET"))));
        assertEquals("QUIET", features.getFirst().code());
        assertEquals(1, features.getFirst().weight());
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void configuredClient_sendsOnlyNonblankProxyHeaders(boolean credentials) throws Exception {
        var http = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var headers = new java.util.concurrent.atomic.AtomicReference<com.sun.net.httpserver.Headers>();
        http.createContext("/v1/taste/interpret", exchange -> {
            headers.set(exchange.getRequestHeaders());
            byte[] response = "{\"tastes\":[]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        http.start();
        try {
            var configured = new AiTasteClient(Validation.buildDefaultValidatorFactory().getValidator(),
                    "http://127.0.0.1:" + http.getAddress().getPort(), credentials ? "key" : "",
                    credentials ? "secret" : "", 1000, 1000);
            assertEquals(List.of(), configured.interpret("sample").tastes());
            assertEquals(credentials ? "key" : null, headers.get().getFirst("Modal-Key"));
            assertEquals(credentials ? "secret" : null, headers.get().getFirst("Modal-Secret"));
        } finally { http.stop(0); }
    }
    @Test void configuredProfileTimeout_throwsTimeout() throws Exception {
        var http = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/v1/taste/profile", exchange -> {
            try { Thread.sleep(300); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            exchange.close();
        });
        http.start();
        try {
            var configured = new AiTasteClient(Validation.buildDefaultValidatorFactory().getValidator(),
                    "http://127.0.0.1:" + http.getAddress().getPort(), "", "", 1000, 50);
            var failure = assertThrows(org.springframework.web.client.ResourceAccessException.class,
                    () -> configured.profile(new Preferences(null, null, null, null)));
            assertInstanceOf(java.net.http.HttpTimeoutException.class, failure.getCause());
        } finally { http.stop(0); }
    }
    static String vectors(int count, int dim) {
        String vector = "[" + String.join(",", java.util.Collections.nCopies(dim, "0.5")) + "]";
        return "{\"model\":\"m\",\"vectors\":[" + String.join(",", java.util.Collections.nCopies(count, vector)) + "]}";
    }
    @Test void vectors_sendsTextsAndReturnsVectorsInOrder() {
        server.expect(requestTo("http://ai.test/v1/taste/vectors")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("{\"texts\":[\"soup\",\"window\"]}", true))
                .andRespond(withSuccess(vectors(2, 1024), MediaType.APPLICATION_JSON));
        var result = client.vectors(List.of("soup", "window"));
        assertEquals(2, result.size());
        assertEquals(1024, result.getFirst().length);
        assertEquals(0.5f, result.getFirst()[0]);
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"1,1024", "2,1023", "2,0"})
    void vectors_wrongCountOrDimension_throws(int count, int dim) {
        server.expect(anything()).andRespond(withSuccess(vectors(count, dim), MediaType.APPLICATION_JSON));
        assertThrows(IllegalStateException.class, () -> client.vectors(List.of("soup", "window")));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"{}", "null", "{\"vectors\":[null,null]}"})
    void vectors_malformed_throws(String body) {
        server.expect(anything()).andRespond(withSuccess(body, MediaType.APPLICATION_JSON));
        assertThrows(RuntimeException.class, () -> client.vectors(List.of("soup", "window")));
    }

}
