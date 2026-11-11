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
                {"features":[{"code":"QUIET","layer":"axis","like":true,"weight":1}],"vectors":[null]}
                """, MediaType.APPLICATION_JSON));
        var profile = client.profile(new Preferences(Preferences.Mood.QUIET, null, null,
                List.of(new Preferences.TasteChip(Preferences.Polarity.LIKE, "quiet", "QUIET"))));
        assertEquals("QUIET", profile.features().getFirst().code());
        assertEquals(1, profile.features().getFirst().weight());
        assertNull(profile.tastes().getFirst().vector());
    }
    @Test void refresh_sendsPreferencesAndReviewEvidence() {
        server.expect(requestTo("http://ai.test/v1/taste/refresh")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                {"mood":"QUIET","priorities":["VALUE"],"purposes":[],"tastes":[],
                "reviews":[{"placeId":1,"reviewId":10,"category":"카페","code":"QUIET",
                "createdAt":"2026-10-23T03:00:00Z","revisitIntent":true}],"bodies":[]}
                """, true)).andRespond(withSuccess("""
                {"features":[{"code":"QUIET","layer":"axis","like":true,"weight":4.319,"category":null},
                {"code":"QUIET","layer":"axis","like":true,"weight":4.319,"category":"CAFE"}]}
                """, MediaType.APPLICATION_JSON));
        var features = client.refresh(
                new Preferences(Preferences.Mood.QUIET, List.of(Preferences.Priority.VALUE), null, null),
                List.of(new AiTasteClient.ReviewEvidence(1, 10, "카페", "QUIET",
                        java.time.Instant.parse("2026-10-23T03:00:00Z"), true)), List.of()).features();
        assertEquals(List.of(new kr.co.fitdining.api.user.TasteFeature("QUIET", "axis", true, 4.319, null),
                new kr.co.fitdining.api.user.TasteFeature("QUIET", "axis", true, 4.319, "CAFE")), features);
    }
    @Test @DisplayName("갱신_본문 추출 항목_구절 없이 리뷰마다 보냄")
    void refresh_sendsBodyItems() {
        server.expect(requestTo("http://ai.test/v1/taste/refresh")).andExpect(content().json("""
                {"bodies":[{"placeId":1,"reviewId":10,"category":"카페","createdAt":"2026-10-23T03:00:00Z",
                "revisitIntent":false,"items":[{"code":"FOOD_SWEET","direction":-1,"liked":1,"kind":"taste"}]}]}
                """)).andRespond(withSuccess("{\"features\":[]}", MediaType.APPLICATION_JSON));
        client.refresh(new Preferences(null, null, null, null), List.of(), List.of(new AiTasteClient.ReviewBody(1, 10,
                "카페", java.time.Instant.parse("2026-10-23T03:00:00Z"), false,
                List.of(new AiTasteClient.BodyItem("맛 성향", "FOOD_SWEET", -1, 1, "taste", null)))));
    }
    @Test @DisplayName("갱신_묶음 원소와 임베딩 실패 여부를 받음")
    void refresh_readsBundlesAndEmbeddingFailure() {
        server.expect(anything()).andRespond(withSuccess("""
                {"features":[{"code":"QUIET","layer":"axis","like":true,"weight":1,"category":null},
                {"code":null,"layer":null,"like":true,"weight":2.5,"category":"CAFE","text":"창가 자리",
                "vector":%s}],"embeddingFailed":false}
                """.formatted(vector(1024)), MediaType.APPLICATION_JSON));
        var refreshed = client.refresh(new Preferences(null, null, null, null), List.of(), List.of());
        var bundle = refreshed.features().get(1);
        assertTrue(bundle.bundle());
        assertEquals("창가 자리", bundle.text());
        assertEquals(1024, bundle.vector().length);
        assertFalse(refreshed.embeddingFailed());
    }
    @DisplayName("갱신_모양이 틀린 묶음_예외")
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
            "{\"code\":null,\"layer\":null,\"like\":true,\"weight\":1,\"text\":\"창가\",\"vector\":[0.5]}",
            "{\"code\":null,\"layer\":null,\"like\":true,\"weight\":1,\"vector\":%s}",
            "{\"code\":null,\"layer\":\"axis\",\"like\":true,\"weight\":1,\"text\":\"창가\",\"vector\":%s}",
            "{\"code\":\"QUIET\",\"layer\":\"axis\",\"like\":true,\"weight\":1,\"text\":\"창가\"}"})
    void refresh_malformedBundle_throws(String feature) {
        server.expect(anything()).andRespond(withSuccess(
                "{\"features\":[" + feature.formatted(vector(1024)) + "]}", MediaType.APPLICATION_JSON));
        assertThrows(RuntimeException.class,
                () -> client.refresh(new Preferences(null, null, null, null), List.of(), List.of()));
    }
    @Test @DisplayName("해석_코드 없는 좋아함 칩_벡터를 칩에 붙여 돌려줌")
    void interpret_attachesVectorToUncodedLikeChip() {
        server.expect(anything()).andRespond(withSuccess("""
                {"tastes":[{"polarity":"LIKE","label":"quiet","code":"QUIET"},{"polarity":"LIKE","label":"창가"}],
                "model":"m","vectors":[null,%s]}
                """.formatted(vector(1024)), MediaType.APPLICATION_JSON));
        var chips = client.interpret("sample").tastes();
        assertNull(chips.get(0).vector());
        assertEquals(1024, chips.get(1).vector().length);
    }
    @Test @DisplayName("추출_리뷰 본문을 보내고_요청 순서대로 항목을 받음")
    void extract_returnsItemsInRequestOrder() {
        server.expect(requestTo("http://ai.test/v1/reviews/extract")).andExpect(method(HttpMethod.POST))
                .andExpect(content().json("""
                {"reviews":[{"reviewId":7,"body":"달지 않아서 좋아요"},{"reviewId":3,"body":"그냥요"}]}
                """, true)).andRespond(withSuccess("""
                {"results":[{"reviewId":7,"items":[{"slot":"맛 성향","quote":"달지 않아서 좋아요","code":"FOOD_SWEET",
                "direction":-1,"liked":1,"kind":"taste","text":null}]},{"reviewId":3,"items":[]}],
                "model":"gpt-6-luna","promptVersion":2}
                """, MediaType.APPLICATION_JSON));
        var extraction = client.extract(List.of(new AiTasteClient.ReviewText(7, "달지 않아서 좋아요"),
                new AiTasteClient.ReviewText(3, "그냥요")));
        assertEquals(new AiTasteClient.ExtractedItem("맛 성향", "달지 않아서 좋아요", "FOOD_SWEET", -1, 1, "taste", null),
                extraction.results().getFirst().items().getFirst());
        assertEquals(List.of(), extraction.results().get(1).items());
        assertEquals(2, extraction.promptVersion());
    }
    @DisplayName("추출_계약을 어긴 응답_예외")
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
            "[{\"reviewId\":3,\"items\":[]}]",
            "[{\"reviewId\":7,\"items\":[{\"slot\":\"s\",\"quote\":\"q\",\"direction\":0,\"kind\":\"taste\"}]}]",
            "[{\"reviewId\":7,\"items\":[{\"slot\":\"s\",\"quote\":\"q\",\"direction\":1,\"liked\":2,\"kind\":\"taste\"}]}]",
            "[{\"reviewId\":7,\"items\":[{\"slot\":\"s\",\"quote\":\"q\",\"direction\":1,\"kind\":\"other\"}]}]"})
    void extract_invalidResponse_throws(String results) {
        server.expect(anything()).andRespond(withSuccess(
                "{\"results\":" + results + ",\"model\":\"m\",\"promptVersion\":2}", MediaType.APPLICATION_JSON));
        assertThrows(RuntimeException.class, () -> client.extract(List.of(new AiTasteClient.ReviewText(7, "본문"))));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"\"weight\":0", "\"weight\":-1.5",
            "\"weight\":2,\"category\":\"PUB\""})
    void refresh_invalidResponse_throws(String field) {
        server.expect(anything()).andRespond(withSuccess("""
                {"features":[{"code":"QUIET","layer":"axis","like":true,%s}]}
                """.formatted(field), MediaType.APPLICATION_JSON));
        assertThrows(RuntimeException.class,
                () -> client.refresh(new Preferences(null, null, null, null), List.of(), List.of()));
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
                    credentials ? "secret" : "", 1000, 1000, 1000);
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
                    "http://127.0.0.1:" + http.getAddress().getPort(), "", "", 1000, 50, 1000);
            var failure = assertThrows(org.springframework.web.client.ResourceAccessException.class,
                    () -> configured.profile(new Preferences(null, null, null, null)));
            assertInstanceOf(java.net.http.HttpTimeoutException.class, failure.getCause());
        } finally { http.stop(0); }
    }
    final Preferences chips = new Preferences(null, null, null, List.of(
            new Preferences.TasteChip(Preferences.Polarity.LIKE, "soup", null),
            new Preferences.TasteChip(Preferences.Polarity.LIKE, "quiet", "QUIET"),
            new Preferences.TasteChip(Preferences.Polarity.DISLIKE, "spicy", null)));
    static String vector(int dim) {
        return "[" + String.join(",", java.util.Collections.nCopies(dim, "0.5")) + "]";
    }
    static String profileWithVectors(String vectors) {
        return "{\"features\":[]" + (vectors == null ? "" : ",\"vectors\":" + vectors) + "}";
    }
    @Test @DisplayName("프로필_코드 없는 좋아함 칩_벡터가 칩 순서대로 붙음")
    void profile_vectorsFollowChipOrder() {
        server.expect(anything()).andRespond(withSuccess(
                profileWithVectors("[" + vector(1024) + ",null,null]"), MediaType.APPLICATION_JSON));
        var tastes = client.profile(chips).tastes();
        assertEquals(chips.tastes(), tastes.stream().map(kr.co.fitdining.api.user.StoredTasteChip::chip).toList());
        assertEquals(1024, tastes.get(0).vector().length);
        assertEquals(0.5f, tastes.get(0).vector()[0]);
        assertNull(tastes.get(1).vector());
        assertNull(tastes.get(2).vector());
    }
    @DisplayName("프로필_벡터 필드 없음이나 null_벡터 없이 features만 받음")
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.NullSource
    @org.junit.jupiter.params.provider.ValueSource(strings = "null")
    void profile_withoutVectors_keepsFeatures(String vectors) {
        server.expect(anything()).andRespond(withSuccess(profileWithVectors(vectors), MediaType.APPLICATION_JSON));
        assertTrue(client.profile(chips).tastes().stream().allMatch(chip -> chip.vector() == null));
    }
    @Test @DisplayName("프로필_벡터가 필요 없는 칩에 벡터_저장하지 않음")
    void profile_vectorOnChipThatNeedsNone_isIgnored() {
        server.expect(anything()).andRespond(withSuccess(
                profileWithVectors("[null," + vector(1024) + "," + vector(1024) + "]"), MediaType.APPLICATION_JSON));
        assertTrue(client.profile(chips).tastes().stream().allMatch(chip -> chip.vector() == null));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"[]", "[null,null]", "[null,null,null,null]", "[[0.5],null,null]"})
    void profile_wrongVectorCountOrDimension_throws(String vectors) {
        server.expect(anything()).andRespond(withSuccess(profileWithVectors(vectors), MediaType.APPLICATION_JSON));
        assertThrows(IllegalStateException.class, () -> client.profile(chips));
    }
}
