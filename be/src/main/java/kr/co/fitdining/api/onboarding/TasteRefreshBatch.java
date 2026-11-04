package kr.co.fitdining.api.onboarding;

import java.sql.Array;
import java.sql.SQLException;
import java.util.*;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewEvidence;
import kr.co.fitdining.api.review.tag.ReasonTag.Sentiment;
import kr.co.fitdining.api.review.tag.ReasonTagRule;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * 04:00 taste refresh (profile-storage D-9). Every run recomputes from the evidence that exists now,
 * so deleted reviews drop out and a user whose AI call failed keeps the old features until the next run.
 */
@Service
@ConditionalOnWebApplication
@ConditionalOnBooleanProperty("fitdining.batch.enabled")
public class TasteRefreshBatch {
    private static final Logger log = LoggerFactory.getLogger(TasteRefreshBatch.class);
    private static final Map<String, String> CATEGORIES = Map.of("RESTAURANT", "식당", "CAFE", "카페", "BAR", "술집");
    private final JdbcClient jdbc;
    private final AiTasteClient client;
    private final JsonMapper json;

    public TasteRefreshBatch(JdbcClient jdbc, AiTasteClient client, JsonMapper json) {
        this.jdbc = jdbc;
        this.client = client;
        this.json = json;
    }

    /**
     * Targets: active users with any review row (deleted ones too, so removals are reflected) or empty features.
     * updated_at is left alone; it tracks the user's own answers (GET /preferences).
     */
    // lockAtLeastFor keeps the other Blue/Green color from rerunning after an early finish.
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "taste-refresh", lockAtLeastFor = "PT30M", lockAtMostFor = "PT3H")
    public void run() {
        // ponytail: all targets and evidence in memory, one AI call per user; page by user_id when users reach ~10^5.
        Map<String, Preferences> targets = targets();
        Map<String, List<ReviewEvidence>> evidence = evidence();
        int failed = 0;
        for (var target : targets.entrySet()) {
            try {
                var features = client.refresh(target.getValue(), evidence.getOrDefault(target.getKey(), List.of()));
                jdbc.sql("update user_preferences set features = cast(:features as jsonb) where user_id = :id")
                        .param("features", json.writeValueAsString(features)).param("id", target.getKey()).update();
            } catch (RuntimeException failure) {
                failed++;
                // Payloads and messages may contain answers, so only the type is logged.
                log.warn("taste_refresh_user_failed kind={}", failure.getClass().getSimpleName());
            }
        }
        log.info("taste_refresh users={} failed={}", targets.size(), failed);
    }

    private Map<String, Preferences> targets() {
        Map<String, Preferences> targets = new LinkedHashMap<>();
        jdbc.sql("""
                select p.user_id, p.mood, p.priorities, p.purposes, p.tastes::text as tastes
                from user_preferences p join auth_users u on u.id = p.user_id
                where u.deleted_at is null
                  and (p.features = '[]'::jsonb or exists (select 1 from reviews r where r.user_id = p.user_id))
                order by p.user_id""").query(rs -> {
            try {
                String mood = rs.getString("mood");
                targets.put(rs.getString("user_id"), new Preferences(
                        mood == null ? null : Preferences.Mood.valueOf(mood),
                        names(rs.getArray("priorities")).stream().map(Preferences.Priority::valueOf).toList(),
                        names(rs.getArray("purposes")).stream().map(Preferences.Purpose::valueOf).toList(),
                        json.readValue(rs.getString("tastes"), new TypeReference<List<TasteChip>>() {})));
            } catch (RuntimeException unreadable) {
                // One bad row must not stop everyone else; the row keeps its features.
                log.warn("taste_refresh_user_unreadable kind={}", unreadable.getClass().getSimpleName());
            }
        });
        return targets;
    }

    private Map<String, List<ReviewEvidence>> evidence() {
        Map<String, List<ReviewEvidence>> byUser = new HashMap<>();
        // Reviews excluded from analysis must drop out too (taste-profile spec 2); add the filter when -56 adds the column.
        jdbc.sql("""
                select r.user_id, r.place_id, r.review_id, r.created_at, p.category_group, t.feature_code, t.sentiment
                from reviews r
                join review_reason_tags rt on rt.review_id = r.review_id
                join reason_tags t on t.code = rt.code
                join places p on p.place_id = r.place_id
                where r.deleted_at is null
                order by r.created_at, r.review_id, t.sort_order""").query(rs -> {
            byUser.computeIfAbsent(rs.getString("user_id"), id -> new ArrayList<>()).add(new ReviewEvidence(
                    rs.getLong("place_id"), rs.getLong("review_id"), CATEGORIES.get(rs.getString("category_group")),
                    ReasonTagRule.userFeatureCode(rs.getString("feature_code"),
                            Sentiment.valueOf(rs.getString("sentiment"))),
                    rs.getTimestamp("created_at").toInstant()));
        });
        return byUser;
    }

    private static List<String> names(Array array) throws SQLException {
        return List.of((String[]) array.getArray());
    }
}
