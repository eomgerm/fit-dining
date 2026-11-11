package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupPhase;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
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
 * 실제 PostgreSQL(Testcontainers)과 V26 마이그레이션으로 모임 만들기, 지역 찾기, 스냅숏을 확인한다. 장소는 카탈로그 DB
 * 모드로 읽는다. 컨테이너는 다른 통합 테스트와 함께 쓰므로 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupPersistenceTest.Configuration.class)
class MeetupPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String USER_PREFIX = "meetup-test-";
	private static final String HOST = USER_PREFIX + "host";
	private static final String GUEST = USER_PREFIX + "guest";
	private static final String WITHDRAWN = USER_PREFIX + "withdrawn";
	/** 테스트가 넣는 장소 id와 (가까운 역, 동). */
	private static final Map<Long, List<String>> PLACES = Map.of(
			9101L, List.of("SEOLLEUNG", "역삼동"),
			9102L, List.of("SEOLLEUNG", "대치동"));
	private static final MeetupCreateRequest.Area SEOLLEUNG = new MeetupCreateRequest.Area(AreaKind.STATION, "선릉");

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock meetupTestClock() {
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
	MeetupService service;

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
		PLACES.forEach((placeId, area) -> jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values (?, ?, ?, 'RESTAURANT', ?, ?, 37.5, 127.05)""",
				placeId, "meetup-test-" + placeId, "모임 테스트 " + placeId, area.get(0), area.get(1)));
		AuthUser withdrawn = new AuthUser(WITHDRAWN, WITHDRAWN + "@example.com", "탈퇴한회원", "hash", NOON, "2026-10-23");
		withdrawn.withdraw(NOON);
		users.saveAll(List.of(
				new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(GUEST, GUEST + "@example.com", "다른회원", "hash", NOON, "2026-10-23"),
				withdrawn));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", USER_PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", USER_PREFIX + "%");
		jdbc.update("delete from places where place_id in (9101, 9102)");
	}

	private MeetupCreateResponse create(LocalDate date, LocalTime time, String description) {
		return service.create(HOST, new MeetupCreateRequest(SEOLLEUNG, null, date, time, 4, description));
	}

	@Nested
	@DisplayName("만들기")
	class Create {

		@Test
		@DisplayName("만들기_정상이면_대기상태와삭제시각과정리한설명이저장된다")
		void create_valid_storesMeetup() {
			MeetupCreateResponse created = create(LocalDate.of(2026, 11, 14), LocalTime.of(19, 0, 42), "  회식 자리 ");

			Map<String, Object> row = jdbc.queryForMap("""
					select phase, area_kind, area_name, category, meet_date, meet_time, headcount, description,
					       expires_at, host_user_id from meetups where code = ?""", created.code());
			assertThat(created.code()).hasSize(22);
			assertThat(row).containsEntry("phase", "WAITING").containsEntry("area_kind", "STATION")
					.containsEntry("area_name", "선릉").containsEntry("category", "RESTAURANT")
					.containsEntry("headcount", 4).containsEntry("description", "회식 자리")
					.containsEntry("host_user_id", HOST);
			assertThat(row.get("meet_time").toString()).isEqualTo("19:00:00");
			assertThat(((java.sql.Timestamp) row.get("expires_at")).toInstant())
					.isEqualTo(Instant.parse("2026-11-21T15:00:00Z"));
			assertThat(created.questions().food()).isTrue();
			assertThat(created.questions().price()).isFalse();
		}

		@Test
		@DisplayName("만들기_여러번만들면_코드가모두다르다")
		void create_twice_codesDiffer() {
			assertThat(create(null, null, null).code()).isNotEqualTo(create(null, null, null).code());
		}

		@Test
		@DisplayName("만들기_동으로도_만들수있다")
		void create_dong_succeeds() {
			MeetupCreateResponse created = service.create(HOST, new MeetupCreateRequest(
					new MeetupCreateRequest.Area(AreaKind.DONG, "역삼동"), MeetupCategory.CAFE, null, null, null, null));
			assertThat(created.questions().food()).isFalse();
		}

		@Test
		@DisplayName("만들기_장소가없는지역이면_400이다")
		void create_areaWithoutPlaces_rejected() {
			assertThatThrownBy(() -> service.create(HOST, new MeetupCreateRequest(
					new MeetupCreateRequest.Area(AreaKind.STATION, "강남"), null, null, null, null, null)))
					.isInstanceOf(InvalidMeetupException.class);
			assertThatThrownBy(() -> service.create(HOST, new MeetupCreateRequest(
					new MeetupCreateRequest.Area(AreaKind.POINT, "선릉"), null, null, null, null, null)))
					.isInstanceOf(InvalidMeetupException.class);
		}

		@Test
		@DisplayName("만들기_오늘인데시각이지났으면_400이다")
		void create_pastTimeToday_rejected() {
			assertThatThrownBy(() -> create(LocalDate.of(2026, 11, 11), LocalTime.of(11, 59), null))
					.isInstanceOf(InvalidMeetupException.class);
		}

		@Test
		@DisplayName("만들기_설명이100자를넘으면_400이고공백뿐이면없는설명이다")
		void create_description_trimmedAndLimited() {
			assertThatThrownBy(() -> create(null, null, "가".repeat(101))).isInstanceOf(InvalidMeetupException.class);
			String code = create(null, null, " " + "가".repeat(100) + " ").code();
			String blank = create(null, null, "  \n ").code();
			assertThat(jdbc.queryForObject("select description from meetups where code = ?", String.class, blank))
					.isNull();
			assertThat(jdbc.queryForObject("select char_length(description) from meetups where code = ?",
					Integer.class, code)).isEqualTo(100);
		}

		@Test
		@DisplayName("만들기_탈퇴한회원이면_401이다")
		void create_withdrawnUser_unauthorized() {
			assertThatThrownBy(() -> service.create(WITHDRAWN, new MeetupCreateRequest(SEOLLEUNG, null, null, null,
					null, null))).isInstanceOf(AuthFailure.class);
		}

	}

	@Nested
	@DisplayName("지역 찾기")
	class Areas {

		@Test
		@DisplayName("지역찾기_장소가있는역과동을_찾는다")
		void areas_fromCatalog() {
			assertThat(service.areas(HOST, "선릉").items())
					.containsExactly(new MeetupAreasResponse.Item(AreaKind.STATION, "선릉"));
			assertThat(service.areas(HOST, "동").items()).extracting(MeetupAreasResponse.Item::name)
					.contains("역삼동", "대치동");
		}

	}

	@Nested
	@DisplayName("스냅숏")
	class Snapshot {

		@Test
		@DisplayName("스냅숏_모임장이면_모임장역할과모임장동작과참여를받는다")
		void snapshot_host_allowsHostActions() {
			String code = create(LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), "회식").code();

			MeetupSnapshot snapshot = service.snapshot(code, HOST);

			assertThat(snapshot.phase()).isEqualTo(MeetupPhase.WAITING);
			assertThat(snapshot.me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.HOST, null, true));
			assertThat(snapshot.allowed()).containsExactly(MeetupAction.EDIT_INFO, MeetupAction.REMOVE_PROFILE,
					MeetupAction.CALCULATE, MeetupAction.JOIN);
			assertThat(snapshot.info()).isEqualTo(new MeetupSnapshot.Info(
					new MeetupSnapshot.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT,
					LocalDate.of(2026, 11, 14), "19:00", 4, "회식", "모임장민재", LocalDate.of(2026, 11, 21)));
		}

		@Test
		@DisplayName("스냅숏_다른회원이나비회원이면_보기만하는사람이다")
		void snapshot_otherUserOrAnonymous_viewer() {
			String code = create(null, null, null).code();

			assertThat(service.snapshot(code, GUEST).me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.VIEWER, null, true));
			MeetupSnapshot anonymous = service.snapshot(code, null);
			assertThat(anonymous.me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.VIEWER, null, false));
			assertThat(anonymous.allowed()).containsExactly(MeetupAction.JOIN);
			assertThat(anonymous.info().expiresOn()).isEqualTo(LocalDate.of(2026, 11, 18));
		}

		@Test
		@DisplayName("스냅숏_없거나형식이틀린코드면_404다")
		void snapshot_unknownCode_notFound() {
			assertThatThrownBy(() -> service.snapshot("AAAAAAAAAAAAAAAAAAAAAA", null))
					.isInstanceOf(MeetupNotFoundException.class);
			assertThatThrownBy(() -> service.snapshot("../etc", null)).isInstanceOf(MeetupNotFoundException.class);
		}

	}

}
