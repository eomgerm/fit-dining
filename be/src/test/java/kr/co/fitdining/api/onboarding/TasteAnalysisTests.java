package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.time.*;
import java.util.List;
import kr.co.fitdining.api.onboarding.TasteAnalyzer.Interpretation;
import kr.co.fitdining.api.user.Preferences.*;
import org.junit.jupiter.api.*;
import org.springframework.web.server.ResponseStatusException;

class TasteAnalysisTests {
    TasteInputLogs logs = mock(TasteInputLogs.class);
    @Test @DisplayName("분석_예문과 알 수 없는 입력_긍정 부정과 빈 결과 방지")
    void analyze_sampleAndUnknown_returnsExpectedChips() {
        var analyzer = new MockTasteAnalyzer();
        assertEquals(List.of(new TasteChip(Polarity.LIKE, "담백한 국물"), new TasteChip(Polarity.DISLIKE, "매운맛")),
                analyzer.analyze("담백한 국물 좋아하고 너무 매운 건 별로예요").tastes());
        assertEquals("mock", analyzer.analyze("국물").model());
        assertEquals(1, analyzer.analyze("새로운 취향").tastes().size());
        assertEquals("나만의 취향", analyzer.analyze("\u0000").tastes().getFirst().label());
        assertTrue(analyzer.analyze("가".repeat(100)).tastes().getFirst().label().length() <= 20);
    }
    @Test @DisplayName("분석_시도 제한_주소별 30회와 창 만료")
    void analyze_rateLimit_countsPerPeerAndExpires() {
        var clock = new MutableClock();
        var service = new TasteAnalysisService(new MockTasteAnalyzer(), logs, clock, 1000);
        try {
            for (int i = 0; i < 30; i++) service.analyze("국물", "one");
            assertEquals(429, assertThrows(ResponseStatusException.class, () -> service.analyze("국물", "one")).getStatusCode().value());
            verify(logs, timeout(1000).times(30)).append(eq("국물"), any(), any());
            assertFalse(service.analyze("국물", "two").isEmpty());
            clock.now = clock.now.plusSeconds(900);
            assertFalse(service.analyze("국물", "one").isEmpty());
        } finally { service.close(); }
    }
    @Test @DisplayName("분석_타임아웃_503 반환과 작업 취소")
    void analyze_timeout_returnsUnavailable() {
        var service = new TasteAnalysisService(text -> {
            try { Thread.sleep(5000); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
            return new Interpretation(List.of(), "test");
        }, logs, Clock.systemUTC(), 20);
        try {
            assertEquals(503, assertThrows(ResponseStatusException.class, () -> service.analyze("국물", "one")).getStatusCode().value());
            verify(logs, timeout(1000)).append(eq("국물"), isNull(), any());
        } finally { service.close(); }
    }
    @Test @DisplayName("분석_성공과 실패_요청마다 원문과 결과를 한 줄 기록")
    void analyze_successAndFailure_appendsOneLogEach() {
        var clock = new MutableClock();
        var service = new TasteAnalysisService(new MockTasteAnalyzer(), logs, clock, 1000);
        try {
            service.analyze("국물", "one");
            verify(logs, timeout(1000)).append("국물", new Interpretation(List.of(new TasteChip(Polarity.LIKE, "국물")), "mock"), clock.now);
            assertEquals(503, assertThrows(ResponseStatusException.class, () -> service.analyze("#실패", "one")).getStatusCode().value());
            verify(logs, timeout(1000)).append("#실패", null, clock.now);
        } finally { service.close(); }
    }
    @Test @DisplayName("분석_기록이 막힘_응답은 기다리지 않음")
    void analyze_blockedLog_doesNotDelayResponse() throws Exception {
        var release = new java.util.concurrent.CountDownLatch(1);
        doAnswer(invocation -> { release.await(); return null; }).when(logs).append(any(), any(), any());
        var service = new TasteAnalysisService(new MockTasteAnalyzer(), logs, Clock.systemUTC(), 1000);
        try {
            assertTimeoutPreemptively(Duration.ofSeconds(1), () -> service.analyze("국물", "one"));
        } finally { release.countDown(); service.close(); }
    }
    @Test @DisplayName("분석_기록 실패_해석 결과는 그대로 반환")
    void analyze_logFailure_stillReturnsChips() {
        doThrow(new IllegalStateException("db down")).when(logs).append(any(), any(), any());
        var service = new TasteAnalysisService(new MockTasteAnalyzer(), logs, Clock.systemUTC(), 1000);
        try {
            assertEquals(List.of(new TasteChip(Polarity.LIKE, "국물")), service.analyze("국물", "one"));
        } finally { service.close(); }
    }
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-26T00:00:00Z");
        public Instant instant() { return now; }
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
    }
}
