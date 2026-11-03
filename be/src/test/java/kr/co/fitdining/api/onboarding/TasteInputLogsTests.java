package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.onboarding.TasteAnalyzer.Interpretation;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.Preferences.Polarity;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

class TasteInputLogsTests extends PostgresTestSupport {
    static final Instant NOW = Instant.parse("2026-11-03T00:00:00Z");
    JdbcTemplate jdbc = new JdbcTemplate(appSource());
    TasteInputLogs logs = new TasteInputLogs(JdbcClient.create(appSource()), JsonMapper.builder().build());

    @BeforeEach void clear() { jdbc.update("delete from taste_input_logs"); }

    @Test @DisplayName("기록_성공과 실패_원문 칩 모델 성공 여부 시각 저장")
    void append_successAndFailure_storesRow() {
        logs.append("매운 건 별로", new Interpretation(List.of(new TasteChip(Polarity.DISLIKE, "매운맛", "FOOD_SPICY")), "gpt-4o-mini"), NOW);
        logs.append("#실패", null, NOW);
        Map<String, Object> ok = jdbc.queryForMap("select text, tastes::text as tastes, model, succeeded, created_at from taste_input_logs where succeeded");
        assertEquals("매운 건 별로", ok.get("text"));
        assertEquals("[{\"code\": \"FOOD_SPICY\", \"label\": \"매운맛\", \"polarity\": \"DISLIKE\"}]", ok.get("tastes"));
        assertEquals("gpt-4o-mini", ok.get("model"));
        assertEquals(Timestamp.from(NOW), ok.get("created_at"));
        Map<String, Object> failed = jdbc.queryForMap("select text, tastes, model from taste_input_logs where not succeeded");
        assertEquals("#실패", failed.get("text"));
        assertNull(failed.get("tastes"));
        assertNull(failed.get("model"));
    }

    @Test @DisplayName("기록_성공인데 칩 없음_DB가 거부")
    void schema_successWithoutTastes_rejected() {
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "insert into taste_input_logs(text, succeeded, created_at) values ('x', true, now())"));
    }

    @Test @DisplayName("정리_보관 기간과 상한_오래된 행만 상한까지 삭제")
    void deleteExpiredBatch_deletesOnlyOlderRowsUpToBatch() {
        for (int i = 0; i < 3; i++) logs.append("old", null, NOW.minusSeconds(91 * 86400));
        logs.append("boundary", null, NOW.minusSeconds(90 * 86400));
        assertEquals(2, logs.deleteExpiredBatch(NOW.minusSeconds(90 * 86400), 2));
        assertEquals(1, jdbc.queryForObject("select count(*) from taste_input_logs where text='old'", Integer.class));
        assertEquals(1, jdbc.queryForObject("select count(*) from taste_input_logs where text='boundary'", Integer.class));
    }
}
