package kr.co.fitdining.api.onboarding;

import java.sql.Array;
import java.sql.SQLException;
import java.time.OffsetDateTime;
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
     * Targets: active users who wrote or deleted a review since their last refresh, or whose features are still
     * empty from a failed onboarding call. A target's whole live history is sent; the AI keeps no state.
     * updated_at is left alone; it tracks the user's own answers (GET /preferences).
     */
    // lockAtLeastFor keeps the other Blue/Green color from rerunning after an early finish.
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "taste-refresh", lockAtLeastFor = "PT30M", lockAtMostFor = "PT3H")
    public void run() {
        // Taken before reading, so a review written mid-run is picked up next time. The margin covers a review whose
        // transaction began earlier but committed after the read, and app clocks a little behind the DB.
        OffsetDateTime started = jdbc.sql("select now() - interval '5 minutes'").query(OffsetDateTime.class).single();
        Map<String, Preferences> targets = targets();
        int failed = 0;
        for (var target : targets.entrySet()) {
            try {
                var features = client.refresh(target.getValue(), evidence(target.getKey()));
                jdbc.sql("""
                        update user_preferences set features = cast(:features as jsonb), features_refreshed_at = :started
                        where user_id = :id""")
                        .param("features", json.writeValueAsString(features)).param("started", started)
                        .param("id", target.getKey()).update();
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
        // ponytail: the exists scans every preferences row's reviews unindexed; index reviews(user_id) if this slows.
        jdbc.sql("""
                select p.user_id, p.mood, p.priorities, p.purposes, p.tastes::text as tastes
                from user_preferences p join auth_users u on u.id = p.user_id
                where u.deleted_at is null
                  and (p.features = '[]'::jsonb and p.features_refreshed_at is null
                       or exists (select 1 from reviews r where r.user_id = p.user_id
                                  and greatest(r.created_at, r.deleted_at)
                                      > coalesce(p.features_refreshed_at, '-infinity')))
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

    private List<ReviewEvidence> evidence(String userId) {
        // Reviews excluded from analysis must drop out too (taste-profile spec 2). When -56 adds the column, filter
        // here and count the exclusion time in the targets query like deleted_at.
        return jdbc.sql("""
                select r.place_id, r.review_id, r.created_at, p.category_group, t.feature_code, t.sentiment
                from reviews r
                join review_reason_tags rt on rt.review_id = r.review_id
                join reason_tags t on t.code = rt.code
                join places p on p.place_id = r.place_id
                where r.user_id = :id and r.deleted_at is null
                order by r.created_at, r.review_id, t.sort_order""").param("id", userId).query((rs, row) ->
                new ReviewEvidence(rs.getLong("place_id"), rs.getLong("review_id"),
                        CATEGORIES.get(rs.getString("category_group")),
                        ReasonTagRule.userFeatureCode(rs.getString("feature_code"),
                                Sentiment.valueOf(rs.getString("sentiment"))),
                        rs.getTimestamp("created_at").toInstant())).list();
    }

    private static List<String> names(Array array) throws SQLException {
        return List.of((String[]) array.getArray());
    }
}
