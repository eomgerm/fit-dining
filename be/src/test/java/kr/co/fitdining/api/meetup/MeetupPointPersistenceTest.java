package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.dto.MeetupAreaCheckResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.MeetupUpdateRequest;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
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
 * 실제 PostgreSQL로 모임 지점의 반경 확인, 지점 모임 만들기와 고치기를 확인한다(AC-58, AC-60). 이 테스트가 만든 회원,
 * 장소, 모임은 앞뒤로 지운다. 다른 테스트의 장소와 섞이지 않게 제주 좌표를 쓴다.
 */
@SpringBootTest
@Import(MeetupPointPersistenceTest.Configuration.class)
class MeetupPointPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-point-test-";
	private static final String HOST = PREFIX + "host";
	private static final double LAT = 33.4500;
	private static final double LNG = 126.5700;

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		Clock meetupPointTestClock() {
			return Clock.fixed(NOON, ZoneOffset.UTC);
		}
	}

	@Autowired
	MeetupService meetupService;

	@Autowired
	AuthUserRepository users;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, dong, lat, lng)
				overriding system value values
				(9331, 'meetup-point-test-9331', '연동 하나', 'RESTAURANT', 'SEOLLEUNG', '연동', 33.4500, 126.5700),
				(9332, 'meetup-point-test-9332', '연동 둘', 'CAFE', 'SEOLLEUNG', '연동', 33.4510, 126.5710),
				(9333, 'meetup-point-test-9333', '이도동 하나', 'BAR', 'SEOLLEUNG', '이도동', 33.4700, 126.5500)""");
		users.save(new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id between 9331 and 9333");
	}

	private String create(MeetupCreateRequest.Area area) {
		return meetupService.create(HOST, new MeetupCreateRequest(area, MeetupCategory.RESTAURANT,
				LocalDate.of(2026, 11, 14), LocalTime.of(19, 0), 4, null)).code();
	}

	private static MeetupCreateRequest.Area point(String name, double lat, double lng, int radiusM) {
		return new MeetupCreateRequest.Area(AreaKind.POINT, name, lat, lng, radiusM);
	}

	private MeetupSnapshot.Area area(String code) {
		return meetupService.snapshot(code, HOST, null).info().area();
	}

	@Test
	@DisplayName("반경확인_반경안장소수와가장많은동에근처를붙인이름을주고_장소가없으면이름이없다")
	void areaCheck_countAndName() {
		assertThat(meetupService.areaCheck(HOST, LAT, LNG, 500)).isEqualTo(new MeetupAreaCheckResponse(2, "연동 근처"));
		assertThat(meetupService.areaCheck(HOST, LAT, LNG, 5000).placeCount()).isEqualTo(3);
		assertThat(meetupService.areaCheck(HOST, 33.9, 126.0, 500)).isEqualTo(new MeetupAreaCheckResponse(0, null));
	}

	@Test
	@DisplayName("반경확인_고를수없는반경이나범위밖좌표는_400이다")
	void areaCheck_invalid() {
		assertThatThrownBy(() -> meetupService.areaCheck(HOST, LAT, LNG, 700))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> meetupService.areaCheck(HOST, 91, LNG, 500))
				.isInstanceOf(InvalidMeetupException.class);
	}

	@Test
	@DisplayName("만들기_지점모임은_지점과반경을저장하고이름을비우면붙인이름을쓴다")
	void create_point_defaultName() {
		String code = create(point("  ", LAT, LNG, 1000));

		assertThat(area(code)).isEqualTo(new MeetupSnapshot.Area(AreaKind.POINT, "연동 근처", LAT, LNG, 1000));
	}

	@Test
	@DisplayName("만들기_위치이름을적으면_앞뒤공백을지워그이름을쓴다")
	void create_point_ownName() {
		String code = create(point("  회사 앞 ", LAT, LNG, 500));

		assertThat(area(code).name()).isEqualTo("회사 앞");
	}

	@Test
	@DisplayName("만들기_반경안에장소가없거나이름이길거나반경이나좌표가틀리면_400이다")
	void create_point_invalid() {
		assertThatThrownBy(() -> create(point(null, 33.9, 126.0, 500))).isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> create(point("가".repeat(21), LAT, LNG, 500)))
				.isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> create(point(null, LAT, LNG, 300))).isInstanceOf(InvalidMeetupException.class);
		assertThatThrownBy(() -> create(new MeetupCreateRequest.Area(AreaKind.POINT, "연동 근처")))
				.isInstanceOf(InvalidMeetupException.class);
	}

	@Test
	@DisplayName("수정_역모임을지점모임으로바꾸고_다시역으로바꾸면지점을지운다")
	void update_pointAndBack() {
		String code = create(new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"));

		meetupService.update(code, HOST, new MeetupUpdateRequest(point(null, LAT, LNG, 2000), null, null, null, null,
				null, Set.of("area")));
		assertThat(area(code)).isEqualTo(new MeetupSnapshot.Area(AreaKind.POINT, "연동 근처", LAT, LNG, 2000));

		meetupService.update(code, HOST, new MeetupUpdateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), null, null, null, null, null, Set.of("area")));
		assertThat(area(code)).isEqualTo(new MeetupSnapshot.Area(AreaKind.STATION, "선릉"));
		assertThat(jdbc.queryForList("select point_lat from meetups where code = ?", Double.class, code))
				.containsExactly((Double) null);
	}

}
