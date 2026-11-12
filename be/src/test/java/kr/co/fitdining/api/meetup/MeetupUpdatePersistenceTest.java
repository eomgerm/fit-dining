package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.MeetupUpdateRequest;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 실제 PostgreSQL로 모임 정보 수정, 삭제 시각 다시 계산, 상태별로 고칠 수 있는 항목, 쿠키 수명을 확인한다(AC-2, AC-22,
 * AC-24). 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupUpdatePersistenceTest.Configuration.class)
class MeetupUpdatePersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-update-test-";
	private static final String HOST = PREFIX + "host";
	private static final String MEMBER = PREFIX + "member";

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock meetupUpdateTestClock() {
			return new MutableClock();
		}
	}

	static final class MutableClock extends Clock {
		volatile Instant instant = NOON;

		@Override
		public ZoneId getZone() {
			return ZoneOffset.UTC;
		}

		@Override
		public Clock withZone(ZoneId zone) {
			return this;
		}

		@Override
		public Instant instant() {
			return instant;
		}
	}

	@Autowired
	MeetupService meetupService;

	@Autowired
	MeetupProfileService profileService;

	@Autowired
	AuthUserRepository users;

	@Autowired
	MutableClock clock;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		clock.instant = NOON;
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values (9311, 'meetup-update-test-9311', '수정 테스트', 'RESTAURANT',
				'SEOLLEUNG', '역삼동', 37.5, 127.05)""");
		users.saveAll(List.of(
				new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(MEMBER, MEMBER + "@example.com", "회원도윤", "hash", NOON, "2026-10-23")));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id = 9311");
	}

	/** 선릉, 식당, 11월 14일 저녁 7시, 4명, "회식" */
	private String meetup() {
		return meetupService.create(HOST, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT,
				LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), 4, "회식")).code();
	}

	private static MeetupUpdateRequest patch(MeetupCreateRequest.Area area, MeetupCategory category,
			LocalDate date, LocalTime time, Integer headcount, String description, String... fields) {
		return new MeetupUpdateRequest(area, category, date, time, headcount, description, Set.of(fields));
	}

	private MeetupSnapshot.Info info(String code) {
		return meetupService.snapshot(code, HOST, null).info();
	}

	private Conflict conflictOf(Runnable action) {
		try {
			action.run();
		} catch (MeetupConflictException e) {
			return e.conflict();
		}
		return null;
	}

	@Test
	@DisplayName("수정_대기에서는_모든항목을고치고날짜가바뀌면열수있는마지막날도바뀐다")
	void update_waiting_allFields() {
		String code = meetup();

		meetupService.update(code, HOST, patch(new MeetupCreateRequest.Area(AreaKind.DONG, "역삼동"),
				MeetupCategory.CAFE, LocalDate.of(2026, 11, 20), LocalTime.of(18, 30, 45), null, "  새 모임  ",
				"area", "category", "date", "time", "headcount", "description"));

		assertThat(info(code)).isEqualTo(new MeetupSnapshot.Info(new MeetupSnapshot.Area(AreaKind.DONG, "역삼동"),
				MeetupCategory.CAFE, LocalDate.of(2026, 11, 20), "18:30", null, "새 모임", "모임장민재"));
	}

	@Test
	@DisplayName("수정_빠진속성은_그대로둔다")
	void update_absentFields_unchanged() {
		String code = meetup();

		meetupService.update(code, HOST, patch(null, null, null, null, 6, null, "headcount"));

		assertThat(info(code)).isEqualTo(new MeetupSnapshot.Info(new MeetupSnapshot.Area(AreaKind.STATION, "선릉"),
				MeetupCategory.RESTAURANT, LocalDate.of(2026, 11, 14), "19:00", 6, "회식", "모임장민재"));
	}

	@Test
	@DisplayName("수정_날짜를비우면_시각도비운다")
	void update_clearDate_clearsTime() {
		String code = meetup();
		clock.instant = NOON.plus(Duration.ofDays(1));

		meetupService.update(code, HOST, patch(null, null, null, null, null, null, "date"));

		MeetupSnapshot.Info info = info(code);
		assertThat(info.date()).isNull();
		assertThat(info.time()).isNull();
	}

	@Test
	@DisplayName("수정_지역업종비우기나고를수없는값은_400이다")
	void update_invalid_rejected() {
		String code = meetup();

		assertThatThrownBy(() -> meetupService.update(code, HOST, patch(null, null, null, null, null, null, "area")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(
				() -> meetupService.update(code, HOST, patch(null, null, null, null, null, null, "category")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.update(code, HOST, patch(
				new MeetupCreateRequest.Area(AreaKind.STATION, "없는역"), null, null, null, null, null, "area")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.update(code, HOST,
				patch(null, null, LocalDate.of(2026, 11, 10), null, null, null, "date")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.update(code, HOST,
				patch(null, null, LocalDate.of(2026, 11, 11), LocalTime.of(11, 0), null, null, "date", "time")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.update(code, HOST,
				patch(null, null, null, LocalTime.of(20, 0), null, null, "date", "time")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.update(code, HOST,
				patch(null, null, null, null, null, "가".repeat(101), "description")))
				.isInstanceOf(InvalidMeetupException.class);
		assertThat(info(code).date()).isEqualTo(LocalDate.of(2026, 11, 14));
	}

	@Test
	@DisplayName("수정_모임장이아니면_403이다")
	void update_notHost_forbidden() {
		String code = meetup();

		assertThatThrownBy(() -> meetupService.update(code, MEMBER, patch(null, null, null, null, 5, null,
				"headcount"))).isInstanceOf(MeetupForbiddenException.class);
	}

	@Test
	@DisplayName("수정_투표중에는_날짜시간만고치고그밖이나날짜비우기는409phase다")
	void update_voting_dateOnly() {
		String code = meetup();
		jdbc.update("""
				update meetups set phase = 'VOTING', poll_state = 'OPEN', poll_anonymous = true,
				poll_place_ids = array[9311]::bigint[] where code = ?""", code);

		meetupService.update(code, HOST, patch(null, null, LocalDate.of(2026, 11, 15), LocalTime.of(18, 0), null,
				null, "date", "time"));
		assertThat(info(code).date()).isEqualTo(LocalDate.of(2026, 11, 15));

		assertThat(conflictOf(() -> meetupService.update(code, HOST, patch(null, null, null, null, 5, null,
				"headcount")))).isEqualTo(Conflict.PHASE);
		assertThat(conflictOf(() -> meetupService.update(code, HOST, patch(null, null, null, null, null, null,
				"date")))).isEqualTo(Conflict.PHASE);
		assertThat(meetupService.snapshot(code, HOST, null).phase()).isEqualTo(MeetupPhase.VOTING);
	}

	@Test
	@DisplayName("수정_추천을받은뒤에고치면_추천이낡았다고보이고취향은그대로다")
	void update_afterResult_outdated() {
		String code = meetup();
		long profileId = profileService.create(code, HOST, new ProfileCreateRequest("민재",
				new Taste(Mood.QUIET, null, null, null, null, null))).profileId();
		jdbc.update("""
				insert into meetup_calculations (meetup_id, state, started_at, finished_at, taste_count, profile_ids)
				select meetup_id, 'SUCCEEDED', ?, ?, 1, array[?]::bigint[] from meetups where code = ?""",
				java.sql.Timestamp.from(NOON), java.sql.Timestamp.from(NOON), profileId, code);
		jdbc.update("update meetups set phase = 'RESULT' where code = ?", code);
		assertThat(meetupService.snapshot(code, HOST, null).calculation().outdated()).isFalse();

		clock.instant = NOON.plusSeconds(60);
		meetupService.update(code, HOST, patch(null, MeetupCategory.CAFE, null, null, null, null, "category"));

		MeetupSnapshot snapshot = meetupService.snapshot(code, HOST, null);
		assertThat(snapshot.calculation().outdated()).isTrue();
		assertThat(snapshot.profiles().getFirst().taste()).isEqualTo(new Taste(Mood.QUIET, null, null, null, null,
				null));
	}

	@Test
	@DisplayName("수정_같은값이면_추천이낡지않는다")
	void update_sameValues_notOutdated() {
		String code = meetup();
		Instant before = jdbc.queryForObject("select info_updated_at from meetups where code = ?", Instant.class,
				code);
		clock.instant = NOON.plusSeconds(60);

		meetupService.update(code, HOST, patch(null, MeetupCategory.RESTAURANT, null, null, 4, null, "category",
				"headcount"));

		assertThat(jdbc.queryForObject("select info_updated_at from meetups where code = ?", Instant.class, code))
				.isEqualTo(before);
	}

	@Test
	@DisplayName("쿠키수명_날짜와상관없이1년이고이모임의쿠키일때만있다")
	void cookieLifetime_oneYear() {
		String code = meetup();
		String token = profileService.create(code, null, new ProfileCreateRequest("하린", null)).token();

		meetupService.update(code, HOST, patch(null, null, LocalDate.of(2026, 11, 20), null, null, null, "date"));

		assertThat(profileService.cookieLifetime(code, token)).contains(Duration.ofDays(365));
		assertThat(profileService.cookieLifetime(code, "없는쿠키")).isEmpty();
		assertThat(profileService.cookieLifetime(meetup(), token)).isEmpty();
	}

}
