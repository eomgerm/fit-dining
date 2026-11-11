package kr.co.fitdining.api.onboarding;

import java.sql.Array;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.*;
import kr.co.fitdining.api.onboarding.AiTasteClient.BodyItem;
import kr.co.fitdining.api.onboarding.AiTasteClient.ExtractedItem;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewBody;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewEvidence;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewText;
import kr.co.fitdining.api.review.tag.ReasonTag.Sentiment;
import kr.co.fitdining.api.review.tag.ReasonTagRule;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.StoredTasteChip;
import kr.co.fitdining.api.user.TasteFeature;
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
 * It first extracts the bodies of new and edited reviews and stores one result per review (taste-profile spec 2단계).
 */
@Service
@ConditionalOnWebApplication
@ConditionalOnBooleanProperty("fitdining.batch.enabled")
public class TasteRefreshBatch {
    private static final Logger log = LoggerFactory.getLogger(TasteRefreshBatch.class);
    private static final Map<String, String> CATEGORIES = Map.of("RESTAURANT", "식당", "CAFE", "카페", "BAR", "술집");
    private static final TypeReference<List<ExtractedItem>> ITEMS = new TypeReference<>() {};
    private static final TypeReference<List<TasteFeature>> FEATURES = new TypeReference<>() {};
    /** A live review with a body whose extraction is missing or older than its last edit. */
    private static final String UNEXTRACTED = """
            r.deleted_at is null and nullif(btrim(r.description), '') is not null
            and (e.review_id is null or r.updated_at > e.extracted_at)""";
    private final JdbcClient jdbc;
    private final AiTasteClient client;
    private final JsonMapper json;

    public TasteRefreshBatch(JdbcClient jdbc, AiTasteClient client, JsonMapper json) {
        this.jdbc = jdbc;
        this.client = client;
        this.json = json;
    }

    /**
     * Targets: active users who wrote, edited or deleted a review since their last refresh, or who were never refreshed
     * (a failed onboarding call left empty features, or V34 cleared the time to fill taste bundles for everyone). A target's whole live history is sent; the AI keeps no state.
     * A user with a review still unextracted (AI failure, or GMS_ENABLED off so the AI answers 503) gets features but
     * keeps the refresh time, so the next run picks them again. So does a user whose review phrases the AI could not
     * embed; their stored taste bundles stay as they were (taste-profile spec 4단계). updated_at is left alone; it tracks the user's own answers (GET /preferences).
     */
    // lockAtLeastFor keeps the other Blue/Green color from rerunning after an early finish.
    @Scheduled(cron = "0 0 4 * * *", zone = "Asia/Seoul")
    @SchedulerLock(name = "taste-refresh", lockAtLeastFor = "PT30M", lockAtMostFor = "PT3H")
    public void run() {
        // Taken before reading, so a review written mid-run is picked up next time. The margin covers a review whose
        // transaction began earlier but committed after the read, and app clocks a little behind the DB.
        OffsetDateTime started = jdbc.sql("select now() - interval '5 minutes'").query(OffsetDateTime.class).single();
        extract(started);
        Map<String, Preferences> targets = targets();
        int failed = 0;
        for (var target : targets.entrySet()) {
            try {
                var refreshed = client.refresh(target.getValue(), evidence(target.getKey()), bodies(target.getKey()));
                List<TasteFeature> features = refreshed.embeddingFailed()
                        ? keepBundles(target.getKey(), refreshed.features()) : refreshed.features();
                jdbc.sql("""
                        update user_preferences set features = cast(:features as jsonb),
                            features_refreshed_at = case when :pending then features_refreshed_at else :started end
                        where user_id = :id""")
                        .param("features", json.writeValueAsString(features)).param("started", started)
                        .param("pending", refreshed.embeddingFailed() || pending(target.getKey()))
                        .param("id", target.getKey()).update();
            } catch (RuntimeException failure) {
                failed++;
                // Payloads and messages may contain answers, so only the type is logged.
                log.warn("taste_refresh_user_failed kind={}", failure.getClass().getSimpleName());
            }
        }
        log.info("taste_refresh users={} failed={}", targets.size(), failed);
    }

    /**
     * Extracts new and edited review bodies, {@link AiTasteClient#EXTRACT_BATCH} per call. The stored time is
     * {@code started}, taken before reading, so a review edited after the read is extracted again next run.
     * A failed call leaves its reviews for the next run.
     */
    private void extract(OffsetDateTime started) {
        List<ReviewText> todo = jdbc.sql("select r.review_id, r.description from reviews r "
                + "left join review_extractions e on e.review_id = r.review_id where " + UNEXTRACTED
                + " order by r.review_id").query((rs, row) ->
                new ReviewText(rs.getLong("review_id"), rs.getString("description"))).list();
        int failed = 0;
        for (int from = 0; from < todo.size(); from += AiTasteClient.EXTRACT_BATCH) {
            var batch = todo.subList(from, Math.min(from + AiTasteClient.EXTRACT_BATCH, todo.size()));
            try {
                var extraction = client.extract(batch);
                for (var review : extraction.results()) {
                    // A review erased between the read and here has nothing to attach to.
                    jdbc.sql("""
                            insert into review_extractions(review_id, items, model, prompt_version, extracted_at)
                            select :id, cast(:items as jsonb), :model, :version, :at
                            where exists (select 1 from reviews where review_id = :id)
                            on conflict (review_id) do update set items = excluded.items, model = excluded.model,
                                prompt_version = excluded.prompt_version, extracted_at = excluded.extracted_at""")
                            .param("id", review.reviewId()).param("items", json.writeValueAsString(review.items()))
                            .param("model", extraction.model()).param("version", extraction.promptVersion())
                            .param("at", started).update();
                }
            } catch (RuntimeException failure) {
                failed += batch.size();
                // Bodies are user text, so only the type is logged.
                log.warn("review_extract_failed kind={}", failure.getClass().getSimpleName());
            }
        }
        log.info("review_extract reviews={} failed={}", todo.size(), failed);
    }

    /** New code features plus the bundles already stored, for a refresh whose bundles could not be recomputed. */
    private List<TasteFeature> keepBundles(String userId, List<TasteFeature> fresh) {
        String stored = jdbc.sql("select features::text from user_preferences where user_id = :id")
                .param("id", userId).query(String.class).single();
        var kept = new ArrayList<>(fresh.stream().filter(feature -> !feature.bundle()).toList());
        kept.addAll(json.readValue(stored, FEATURES).stream().filter(TasteFeature::bundle).toList());
        return kept;
    }

    private boolean pending(String userId) {
        return Boolean.TRUE.equals(jdbc.sql("select exists (select 1 from reviews r "
                + "left join review_extractions e on e.review_id = r.review_id where r.user_id = :id and "
                + UNEXTRACTED + ")").param("id", userId).query(Boolean.class).single());
    }

    private Map<String, Preferences> targets() {
        Map<String, Preferences> targets = new LinkedHashMap<>();
        // ponytail: the exists scans every preferences row's reviews unindexed; index reviews(user_id) if this slows.
        jdbc.sql("""
                select p.user_id, p.mood, p.priorities, p.purposes, p.tastes::text as tastes
                from user_preferences p join auth_users u on u.id = p.user_id
                where u.deleted_at is null
                  and (p.features_refreshed_at is null
                       or exists (select 1 from reviews r where r.user_id = p.user_id
                                  and greatest(r.created_at, r.updated_at, r.deleted_at)
                                      > coalesce(p.features_refreshed_at, '-infinity')))
                order by p.user_id""").query(rs -> {
            try {
                String mood = rs.getString("mood");
                targets.put(rs.getString("user_id"), new Preferences(
                        mood == null ? null : Preferences.Mood.valueOf(mood),
                        names(rs.getArray("priorities")).stream().map(Preferences.Priority::valueOf).toList(),
                        names(rs.getArray("purposes")).stream().map(Preferences.Purpose::valueOf).toList(),
                        json.readValue(rs.getString("tastes"), new TypeReference<List<StoredTasteChip>>() {})
                                .stream().map(StoredTasteChip::chipWithVector).toList()));
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
                select r.place_id, r.review_id, r.created_at, r.revisit_intent, p.category_group, t.feature_code,
                       t.sentiment
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
                        rs.getTimestamp("created_at").toInstant(), rs.getBoolean("revisit_intent"))).list();
    }

    /** Current extractions of the user's live reviews; a stale one (edited after extraction) waits for the next run. */
    private List<ReviewBody> bodies(String userId) {
        return jdbc.sql("""
                select r.place_id, r.review_id, r.created_at, r.revisit_intent, p.category_group, e.items::text as items
                from reviews r
                join review_extractions e on e.review_id = r.review_id
                join places p on p.place_id = r.place_id
                where r.user_id = :id and r.deleted_at is null and r.updated_at <= e.extracted_at
                order by r.created_at, r.review_id""").param("id", userId).query((rs, row) ->
                new ReviewBody(rs.getLong("place_id"), rs.getLong("review_id"),
                        CATEGORIES.get(rs.getString("category_group")), rs.getTimestamp("created_at").toInstant(),
                        rs.getBoolean("revisit_intent"), json.readValue(rs.getString("items"), ITEMS).stream()
                        .map(i -> new BodyItem(i.slot(), i.code(), i.direction(), i.liked(), i.kind(), i.text()))
                        .toList()))
                .list();
    }

    private static List<String> names(Array array) throws SQLException {
        return List.of((String[]) array.getArray());
    }
}
