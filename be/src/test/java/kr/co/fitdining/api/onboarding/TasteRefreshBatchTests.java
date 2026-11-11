package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kr.co.fitdining.api.onboarding.AiTasteClient.BodyItem;
import kr.co.fitdining.api.onboarding.AiTasteClient.ExtractedItem;
import kr.co.fitdining.api.onboarding.AiTasteClient.ExtractedReview;
import kr.co.fitdining.api.onboarding.AiTasteClient.Extraction;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewBody;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewEvidence;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewText;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.Preferences.Priority;
import kr.co.fitdining.api.user.TasteFeature;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

class TasteRefreshBatchTests extends PostgresTestSupport {
    static final String PREFIX = "trb-";
    static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");
    /** jsonb text form: keys come back ordered by length, then name. */
    static final String OLD = "[{\"code\": \"COZY\", \"like\": true, \"layer\": \"importance\", \"weight\": 1}]";
    static final List<TasteFeature> NEW = List.of(new TasteFeature("QUIET", "axis", true, 4.319, "CAFE"));
    JdbcTemplate jdbc = new JdbcTemplate(appSource());
    AiTasteClient client = mock(AiTasteClient.class);
    /** Same as the app's spring.jackson.deserialization.fail-on-unknown-properties. */
    TasteRefreshBatch batch = new TasteRefreshBatch(JdbcClient.create(appSource()), client,
            JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build());
    /** Each user gets a distinct priority so the fake AI can tell whose request it is. */
    Map<Priority, List<ReviewEvidence>> sent = new HashMap<>();
    Map<Priority, List<ReviewBody>> sentBodies = new HashMap<>();
    Map<Priority, Preferences> asked = new HashMap<>();
    /** Review ids of each extraction call. */
    List<List<Long>> extractCalls = new ArrayList<>();
    boolean extractFails;
    static final String SWEET = "달지 않아서 좋아요";
    static final ExtractedItem SWEET_ITEM = new ExtractedItem("맛 성향", SWEET, "FOOD_SWEET", -1, 1, "taste", null);
    /** Runs inside the fake AI call, i.e. while the batch is mid-run. */
    Runnable during = () -> {};

    @BeforeAll static void migrateOnce() throws Exception { migrate(); }

    @BeforeEach void setUp() {
        cleanUp();
        // Batch targets come from user_preferences, so other classes' rows would make extra AI calls.
        jdbc.update("delete from user_preferences");
        jdbc.update("insert into places (place_id, naver_place_id, name, category_group, station, lat, lng) "
                + "overriding system value values (900001, 'trb-1', '갱신 카페', 'CAFE', 'YEOKSAM', 37.5, 127.03), "
                + "(900002, 'trb-2', '갱신 식당', 'RESTAURANT', 'YEOKSAM', 37.5, 127.03)");
        when(client.extract(any())).thenAnswer(call -> {
            List<ReviewText> reviews = call.getArgument(0);
            extractCalls.add(reviews.stream().map(ReviewText::reviewId).toList());
            if (extractFails) throw new IllegalStateException("AI down");
            return new Extraction(reviews.stream().map(r -> new ExtractedReview(r.reviewId(),
                    r.body().contains(SWEET) ? List.of(SWEET_ITEM) : List.of())).toList(), "test-model", 2);
        });
        when(client.refresh(any(), any(), any())).thenAnswer(call -> {
            Preferences preferences = call.getArgument(0);
            Priority priority = preferences.priorities().getFirst();
            sent.put(priority, call.getArgument(1));
            sentBodies.put(priority, call.getArgument(2));
            asked.put(priority, preferences);
            during.run();
            if (priority == Priority.VIEW_OUTDOOR) throw new IllegalStateException("AI down");
            return priority == Priority.GENEROUS_PORTION ? List.of() : NEW;
        });
    }

    @AfterEach void cleanUp() {
        jdbc.update("delete from review_reason_tags where review_id in (select review_id from reviews where user_id like ?)", PREFIX + "%");
        jdbc.update("delete from reviews where user_id like ?", PREFIX + "%");
        jdbc.update("delete from user_preferences where user_id like ?", PREFIX + "%");
        jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
        jdbc.update("delete from places where naver_place_id like ?", PREFIX + "%");
    }

    @Test @DisplayName("갱신_리뷰가 있는 회원_지우지 않은 리뷰 태그를 사용자 쪽 코드로 보내고 features만 바꾼다")
    void reviewer_sendsLiveEvidenceAndStoresFeatures() {
        user("a", Priority.VALUE, OLD);
        jdbc.update("update user_preferences set purposes = '{WORK_STUDY}', tastes = ?::jsonb where user_id = ?",
                "[{\"polarity\": \"DISLIKE\", \"label\": \"매운맛\", \"code\": \"FOOD_SPICY\"}, "
                        + "{\"polarity\": \"LIKE\", \"label\": \"국물\", \"code\": null, \"vector\": [0.1, 0.2]}]",
                PREFIX + "a");
        long cafe = review("a", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD", "SHORT_WAIT_BAD");
        long noisy = review("a", 900002, "2026-10-24T03:00:00Z", "LIVELY_BAD");
        jdbc.update("update reviews set revisit_intent = true where review_id = ?", noisy);
        long deleted = review("a", 900001, "2026-10-25T03:00:00Z", "LIVELY_GOOD");
        jdbc.update("update reviews set deleted_at = now() where review_id = ?", deleted);

        batch.run();

        assertEquals(List.of(
                new ReviewEvidence(900001, cafe, "카페", "QUIET", Instant.parse("2026-10-23T03:00:00Z"), false),
                new ReviewEvidence(900001, cafe, "카페", "SHORT_WAIT", Instant.parse("2026-10-23T03:00:00Z"), false),
                new ReviewEvidence(900002, noisy, "식당", "QUIET", Instant.parse("2026-10-24T03:00:00Z"), true)),
                sent.get(Priority.VALUE));
        assertEquals(new Preferences(Preferences.Mood.QUIET, List.of(Priority.VALUE),
                List.of(Preferences.Purpose.WORK_STUDY), List.of(
                        new Preferences.TasteChip(Preferences.Polarity.DISLIKE, "매운맛", "FOOD_SPICY"),
                        new Preferences.TasteChip(Preferences.Polarity.LIKE, "국물"))), asked.get(Priority.VALUE));
        assertEquals("[{\"code\": \"QUIET\", \"like\": true, \"layer\": \"axis\", \"weight\": 4.319, "
                + "\"category\": \"CAFE\"}]", features("a"));
        assertEquals(Timestamp.from(T0), jdbc.queryForObject(
                "select updated_at from user_preferences where user_id = ?", Timestamp.class, PREFIX + "a"));
        assertNotNull(refreshedAt("a"));
    }

    @Test @DisplayName("갱신_대상_리뷰 있거나 features 빈 회원만이고 탈퇴 회원은 뺀다")
    void targets_reviewersAndEmptyFeaturesOnly() {
        user("empty", Priority.COZY, "[]");
        user("idle", Priority.SHORT_WAIT, OLD);
        user("gone", Priority.GENEROUS_PORTION, "[]");
        review("gone", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update auth_users set deleted_at = now() where id = ?", PREFIX + "gone");
        user("erased", Priority.PRETTY_SPACE, OLD);
        long only = review("erased", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set deleted_at = now() where review_id = ?", only);

        batch.run();

        assertEquals(Map.of(Priority.COZY, List.of(), Priority.PRETTY_SPACE, List.of()), sent);
        assertNotEquals("[]", features("empty"));
        assertEquals(OLD, features("idle"));
        assertNotEquals(OLD, features("erased"));
    }

    @Test @DisplayName("갱신_AI 실패_그 회원은 기존 값을 두고 다른 회원은 갱신한다")
    void aiFailure_keepsOldValueAndContinues() {
        user("down", Priority.VIEW_OUTDOOR, OLD);
        review("down", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        user("ok", Priority.COZY, "[]");

        batch.run();

        assertEquals(OLD, features("down"));
        assertNotEquals("[]", features("ok"));
    }

    // 2단계에서 고친 리뷰도 대상이 됐다(profile-storage D-15 변경). 본문을 고치면 맛 근거가 달라진다.
    @Test @DisplayName("갱신_다음 실행_리뷰를 쓰거나 고치거나 지운 회원만 다시 계산한다")
    void nextRun_onlyWrittenEditedOrDeletedSinceLastRefresh() {
        user("same", Priority.COZY, "[]");
        review("same", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        user("edited", Priority.SHORT_WAIT, OLD);
        long edited = review("edited", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        user("wrote", Priority.PRETTY_SPACE, OLD);
        long old = review("wrote", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        user("erased", Priority.VALUE, OLD);
        long erased = review("erased", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        batch.run();
        assertNotNull(refreshedAt("same"));
        sent.clear();

        jdbc.update("update reviews set description = '고침', updated_at = now() where review_id = ?", edited);
        long fresh = review("wrote", 900002, Instant.now().toString(), "LIVELY_BAD");
        jdbc.update("update reviews set deleted_at = now(), updated_at = now() where review_id = ?", erased);
        batch.run();

        assertEquals(Set.of(Priority.SHORT_WAIT, Priority.PRETTY_SPACE, Priority.VALUE), sent.keySet());
        // The AI is stateless, so a changed user's whole live history goes out, not just the new review.
        assertEquals(List.of(old, fresh), sent.get(Priority.PRETTY_SPACE).stream().map(ReviewEvidence::reviewId).toList());
        assertEquals(List.of(), sent.get(Priority.VALUE));
    }

    @Test @DisplayName("갱신_실행 중 쓴 리뷰_다음 실행에서 반영한다")
    void writtenMidRun_pickedUpNextRun() {
        user("busy", Priority.COZY, OLD);
        review("busy", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        during = () -> {
            during = () -> {};
            review("busy", 900002, Instant.now().toString(), "LIVELY_BAD");
        };
        batch.run();
        sent.clear();

        batch.run();

        assertEquals(2, sent.get(Priority.COZY).stream().map(ReviewEvidence::reviewId).distinct().count());
    }

    @Test @DisplayName("갱신_계산 결과가 빈 회원_한 번 계산한 뒤에는 다시 부르지 않는다")
    void emptyResult_notRecalledEveryRun() {
        user("blank", Priority.GENEROUS_PORTION, "[]");
        batch.run();
        assertEquals("[]", features("blank"));
        sent.clear();

        batch.run();

        assertEquals(Map.of(), sent);
    }

    @Test @DisplayName("갱신_AI 실패_다음 실행에서 그 회원을 다시 계산한다")
    void aiFailure_retriedNextRun() {
        user("down", Priority.VIEW_OUTDOOR, OLD);
        review("down", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        batch.run();
        assertNull(refreshedAt("down"));
        sent.clear();

        batch.run();

        assertEquals(1, sent.get(Priority.VIEW_OUTDOOR).size());
    }

    @Test @DisplayName("본문_새 리뷰 본문을 추출해 저장하고_구절 없이 갱신 근거로 보낸다")
    void body_extractedStoredAndSent() {
        user("taster", Priority.COZY, OLD);
        long id = review("taster", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set description = ? where review_id = ?", SWEET, id);

        batch.run();

        assertEquals(List.of(List.of(id)), extractCalls);
        assertEquals(Map.of("model", "test-model", "prompt_version", 2), jdbc.queryForMap(
                "select model, prompt_version from review_extractions where review_id = ?", id));
        assertEquals(List.of(new ReviewBody(900001, id, "카페", Instant.parse("2026-10-23T03:00:00Z"), false,
                List.of(new BodyItem("FOOD_SWEET", -1, 1, "taste", null)))), sentBodies.get(Priority.COZY));
        assertNotNull(refreshedAt("taster"));
    }

    @Test @DisplayName("본문_빈 본문과 지운 리뷰_추출하지 않고 갱신을 막지 않는다")
    void body_blankOrDeleted_notExtracted() {
        user("quiet", Priority.COZY, OLD);
        long blank = review("quiet", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set description = '   ' where review_id = ?", blank);
        long deleted = review("quiet", 900002, "2026-10-24T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set description = ?, deleted_at = now() where review_id = ?", SWEET, deleted);

        batch.run();

        assertEquals(List.of(), extractCalls);
        assertEquals(List.of(), sentBodies.get(Priority.COZY));
        assertNotNull(refreshedAt("quiet"));
    }

    @Test @DisplayName("본문_추출 실패_태그로 계산한 취향은 쓰고 갱신 시각은 두어 다음 실행에서 다시 추출한다")
    void body_extractFailure_writesFeaturesAndRetriesNextRun() {
        user("later", Priority.COZY, OLD);
        long id = review("later", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set description = ? where review_id = ?", SWEET, id);
        extractFails = true;

        batch.run();

        assertNotEquals(OLD, features("later"));
        assertNull(refreshedAt("later"));
        assertEquals(List.of(), sentBodies.get(Priority.COZY));
        extractFails = false;
        sentBodies.clear();

        batch.run();

        assertEquals(1, sentBodies.get(Priority.COZY).size());
        assertNotNull(refreshedAt("later"));
    }

    @Test @DisplayName("본문_고친 리뷰_다시 추출하고 그 전까지 옛 결과는 보내지 않는다")
    void body_editedReview_reextracted() {
        user("editor", Priority.COZY, OLD);
        long id = review("editor", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD");
        jdbc.update("update reviews set description = '그냥 그랬어요' where review_id = ?", id);
        batch.run();
        assertEquals(List.of(), sentBodies.get(Priority.COZY).getFirst().items());
        // Runs are seconds apart here; move the first run an hour back so the edit falls between the runs and outside
        // the 5-minute margin, as it would between two nights.
        jdbc.update("update review_extractions set extracted_at = extracted_at - interval '1 hour' where review_id = ?",
                id);
        jdbc.update("update user_preferences set features_refreshed_at = features_refreshed_at - interval '1 hour' "
                + "where user_id = ?", PREFIX + "editor");
        Timestamp first = refreshedAt("editor");

        jdbc.update("update reviews set description = ?, updated_at = now() - interval '30 minutes' "
                + "where review_id = ?", SWEET, id);
        extractFails = true;
        batch.run();
        assertEquals(List.of(), sentBodies.get(Priority.COZY));
        assertEquals(first, refreshedAt("editor"));

        extractFails = false;
        batch.run();
        assertEquals(List.of(List.of(id), List.of(id), List.of(id)), extractCalls);
        assertEquals(List.of(new BodyItem("FOOD_SWEET", -1, 1, "taste", null)),
                sentBodies.get(Priority.COZY).getFirst().items());
        assertNotEquals(first, refreshedAt("editor"));
    }

    void user(String id, Priority priority, String features) {
        jdbc.update("insert into auth_users(id, email, nickname, password_hash, created_at, age_confirmed_at, "
                + "terms_agreed_at, privacy_agreed_at, terms_version) values (?, ?, ?, 'x', ?, ?, ?, ?, 'v1')",
                PREFIX + id, PREFIX + id + "@example.com", "trb" + id, Timestamp.from(T0), Timestamp.from(T0),
                Timestamp.from(T0), Timestamp.from(T0));
        jdbc.update("insert into user_preferences(user_id, mood, priorities, purposes, tastes, features, created_at, "
                + "updated_at) values (?, 'QUIET', ?::text[], '{}', '[]', ?::jsonb, ?, ?)", PREFIX + id,
                "{" + priority.name() + "}", features, Timestamp.from(T0), Timestamp.from(T0));
    }

    long review(String user, long place, String createdAt, String... tags) {
        // The app sets updated_at to created_at on insert (Review), so a new review is not an edit.
        Long id = jdbc.queryForObject("insert into reviews(place_id, user_id, visit_date, created_at, updated_at) "
                + "values (?, ?, ?::timestamptz::date, ?::timestamptz, ?::timestamptz) returning review_id", Long.class,
                place, PREFIX + user, createdAt, createdAt, createdAt);
        for (String tag : tags) jdbc.update("insert into review_reason_tags(review_id, code) values (?, ?)", id, tag);
        return id;
    }

    Timestamp refreshedAt(String user) {
        return jdbc.queryForObject("select features_refreshed_at from user_preferences where user_id = ?",
                Timestamp.class, PREFIX + user);
    }

    String features(String user) {
        return jdbc.queryForObject("select features::text from user_preferences where user_id = ?", String.class,
                PREFIX + user);
    }
}
