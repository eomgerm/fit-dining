package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import java.time.*;
import java.util.List;
import kr.co.fitdining.api.user.Preferences.*;
import org.junit.jupiter.api.*;
import org.springframework.web.server.ResponseStatusException;

class TasteAnalysisTests {
    @Test @DisplayName("분석_예문과 알 수 없는 입력_긍정 부정과 빈 결과 방지")
    void analyze_sampleAndUnknown_returnsExpectedChips() {
        var analyzer = new MockTasteAnalyzer();
        assertEquals(List.of(new TasteChip(Polarity.LIKE, "담백한 국물"), new TasteChip(Polarity.DISLIKE, "매운맛")),
                analyzer.analyze("담백한 국물 좋아하고 너무 매운 건 별로예요"));
        assertEquals(1, analyzer.analyze("새로운 취향").size());
        assertTrue(analyzer.analyze("가".repeat(100)).getFirst().label().length() <= 20);
    }
    @Test @DisplayName("분석_시도 제한_주소별 30회와 창 만료")
    void analyze_rateLimit_countsPerPeerAndExpires() {
        var clock = new MutableClock();
        var service = new TasteAnalysisService(new MockTasteAnalyzer(), clock, 1000);
        try {
            for (int i = 0; i < 30; i++) service.analyze("국물", "one");
            assertEquals(429, assertThrows(ResponseStatusException.class, () -> service.analyze("국물", "one")).getStatusCode().value());
            assertFalse(service.analyze("국물", "two").isEmpty());
            clock.now = clock.now.plusSeconds(900);
            assertFalse(service.analyze("국물", "one").isEmpty());
        } finally { service.close(); }
    }
    @Test @DisplayName("분석_타임아웃_503 반환과 작업 취소")
    void analyze_timeout_returnsUnavailable() {
        var service = new TasteAnalysisService(text -> {
            try { Thread.sleep(5000); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
            return List.of();
        }, Clock.systemUTC(), 20);
        try {
            assertEquals(503, assertThrows(ResponseStatusException.class, () -> service.analyze("국물", "one")).getStatusCode().value());
        } finally { service.close(); }
    }
    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-26T00:00:00Z");
        public Instant instant() { return now; }
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
    }
}
