package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.onboarding.AiTasteClient.ReviewEvidence;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.Preferences;
import kr.co.fitdining.api.user.Preferences.Priority;
import kr.co.fitdining.api.user.TasteFeature;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

class TasteRefreshBatchTests extends PostgresTestSupport {
    static final String PREFIX = "trb-";
    static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");
    /** jsonb text form: keys come back ordered by length, then name. */
    static final String OLD = "[{\"code\": \"COZY\", \"like\": true, \"layer\": \"importance\", \"weight\": 1}]";
    static final List<TasteFeature> NEW = List.of(new TasteFeature("QUIET", "axis", true, 2));
    JdbcTemplate jdbc = new JdbcTemplate(appSource());
    AiTasteClient client = mock(AiTasteClient.class);
    TasteRefreshBatch batch = new TasteRefreshBatch(JdbcClient.create(appSource()), client, JsonMapper.builder().build());
    /** Each user gets a distinct priority so the fake AI can tell whose request it is. */
    Map<Priority, List<ReviewEvidence>> sent = new HashMap<>();
    Map<Priority, Preferences> asked = new HashMap<>();

    @BeforeAll static void migrateOnce() throws Exception { migrate(); }

    @BeforeEach void setUp() {
        cleanUp();
        // Batch targets come from user_preferences, so other classes' rows would make extra AI calls.
        jdbc.update("delete from user_preferences");
        jdbc.update("insert into places (place_id, naver_place_id, name, category_group, station, lat, lng) "
                + "overriding system value values (900001, 'trb-1', '갱신 카페', 'CAFE', 'YEOKSAM', 37.5, 127.03), "
                + "(900002, 'trb-2', '갱신 식당', 'RESTAURANT', 'YEOKSAM', 37.5, 127.03)");
        when(client.refresh(any(), any())).thenAnswer(call -> {
            Preferences preferences = call.getArgument(0);
            Priority priority = preferences.priorities().getFirst();
            sent.put(priority, call.getArgument(1));
            asked.put(priority, preferences);
            if (priority == Priority.VIEW_OUTDOOR) throw new IllegalStateException("AI down");
            return NEW;
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
                        + "{\"polarity\": \"LIKE\", \"label\": \"국물\"}]", PREFIX + "a");
        long cafe = review("a", 900001, "2026-10-23T03:00:00Z", "QUIET_GOOD", "SHORT_WAIT_BAD");
        long noisy = review("a", 900002, "2026-10-24T03:00:00Z", "LIVELY_BAD");
        long deleted = review("a", 900001, "2026-10-25T03:00:00Z", "LIVELY_GOOD");
        jdbc.update("update reviews set deleted_at = now() where review_id = ?", deleted);

        batch.run();

        assertEquals(List.of(
                new ReviewEvidence(900001, cafe, "카페", "QUIET", Instant.parse("2026-10-23T03:00:00Z")),
                new ReviewEvidence(900001, cafe, "카페", "SHORT_WAIT", Instant.parse("2026-10-23T03:00:00Z")),
                new ReviewEvidence(900002, noisy, "식당", "QUIET", Instant.parse("2026-10-24T03:00:00Z"))),
                sent.get(Priority.VALUE));
        assertEquals(new Preferences(Preferences.Mood.QUIET, List.of(Priority.VALUE),
                List.of(Preferences.Purpose.WORK_STUDY), List.of(
                        new Preferences.TasteChip(Preferences.Polarity.DISLIKE, "매운맛", "FOOD_SPICY"),
                        new Preferences.TasteChip(Preferences.Polarity.LIKE, "국물"))), asked.get(Priority.VALUE));
        assertEquals("[{\"code\": \"QUIET\", \"like\": true, \"layer\": \"axis\", \"weight\": 2}]", features("a"));
        assertEquals(Timestamp.from(T0), jdbc.queryForObject(
                "select updated_at from user_preferences where user_id = ?", Timestamp.class, PREFIX + "a"));
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
        Long id = jdbc.queryForObject("insert into reviews(place_id, user_id, visit_date, created_at) "
                + "values (?, ?, ?::timestamptz::date, ?::timestamptz) returning review_id", Long.class,
                place, PREFIX + user, createdAt, createdAt);
        for (String tag : tags) jdbc.update("insert into review_reason_tags(review_id, code) values (?, ?)", id, tag);
        return id;
    }

    String features(String user) {
        return jdbc.queryForObject("select features::text from user_preferences where user_id = ?", String.class,
                PREFIX + user);
    }
}
