package kr.co.fitdining.api.onboarding;

import java.sql.Timestamp;
import java.time.Instant;
import kr.co.fitdining.api.onboarding.TasteAnalyzer.Interpretation;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

/** Raw direct-input log (V15). Rows carry no user or address; callers must not log what they write. */
@Repository
public class TasteInputLogs {
    private final JdbcClient jdbc;
    private final JsonMapper json;

    public TasteInputLogs(JdbcClient jdbc, JsonMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /** @param result null when the analysis failed */
    public void append(String text, Interpretation result, Instant at) {
        jdbc.sql("insert into taste_input_logs(text, tastes, model, succeeded, created_at) "
                        + "values (:text, cast(:tastes as jsonb), :model, :succeeded, :at)")
                .param("text", text)
                .param("tastes", result == null ? null : json.writeValueAsString(result.tastes()))
                .param("model", result == null ? null : result.model())
                .param("succeeded", result != null)
                .param("at", Timestamp.from(at))
                .update();
    }

    public int deleteExpiredBatch(Instant cutoff, int batch) {
        return jdbc.sql("delete from taste_input_logs where id in (select id from taste_input_logs "
                        + "where created_at < :cutoff order by created_at, id limit :batch)")
                .param("cutoff", Timestamp.from(cutoff))
                .param("batch", batch)
                .update();
    }
}
