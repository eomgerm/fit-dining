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
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupListResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.UserService;
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
import org.springframework.transaction.IllegalTransactionStateException;

/**
 * 실제 PostgreSQL과 Redis(Testcontainers)로 회원 기준의 모임을 확인한다. 회원 탈퇴의 모임 정리, 날짜가 지난 모임,
 * 모임 뒤 판정, 내 모임이다(AC-2, AC-61 ~ AC-64, AC-73, AC-75). 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupWithdrawalPersistenceTest.Configuration.class)
class MeetupWithdrawalPersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-withdrawal-test-";
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
		MutableClock meetupWithdrawalTestClock() {
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
	MeetupWithdrawals withdrawals;

	@Autowired
	MeetupListService listService;

	@Autowired
	UserService userService;

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
				overriding system value values (9121, 'meetup-withdrawal-test-9121', '탈퇴 테스트', 'RESTAURANT',
				'SEOLLEUNG', '역삼동', 37.5, 127.05)""");
		users.saveAll(List.of(
				new AuthUser(HOST, HOST + "@example.com", "모임장민재", "hash", NOON, "2026-10-23"),
				new AuthUser(MEMBER, MEMBER + "@example.com", "회원도윤", "hash", NOON, "2026-10-23")));
	}

	@AfterEach
	void tearDown() {
		cleanUp();
	}

	@Test
	@DisplayName("탈퇴_만든모임은지워지고_다른모임의내프로필만지워진다")
	void withdraw_removesHostedMeetupsAndOwnProfiles() {
		String hosted = meetup(HOST, null);
		String own = meetup(MEMBER, null);
		profileService.create(hosted, HOST, new ProfileCreateRequest("민재", null));
		profileService.create(hosted, MEMBER, new ProfileCreateRequest("도윤", null));
		String guestToken = profileService.create(hosted, null, new ProfileCreateRequest("하린", null)).token();
		String memberToken = profileService.create(own, MEMBER, new ProfileCreateRequest("도윤", null)).token();
		profileService.create(own, null, new ProfileCreateRequest("서진", null));

		userService.withdraw(MEMBER, new AuthUseCases.Identity(MEMBER, null, 0));

		assertThatThrownBy(() -> meetupService.snapshot(own, null, memberToken))
				.isInstanceOf(MeetupNotFoundException.class);
		assertThat(jdbc.queryForObject("""
				select count(*) from meetup_profiles p join meetups m on m.meetup_id = p.meetup_id
				where m.code = ?""", Integer.class, own)).isZero();
		assertThat(jdbc.queryForObject("select count(*) from meetup_profiles where user_id = ?", Integer.class,
				MEMBER)).isZero();
		MeetupSnapshot snapshot = meetupService.snapshot(hosted, null, guestToken);
		assertThat(snapshot.profiles()).extracting(MeetupSnapshot.Profile::name).containsExactly("민재", "하린");
		assertThat(snapshot.me().profileId()).isNotNull();
	}

	@Test
	@DisplayName("탈퇴정리_탈퇴트랜잭션밖에서는_부를수없다")
	void withdrawals_outsideTransaction_rejected() {
		assertThatThrownBy(() -> withdrawals.withdraw(MEMBER)).isInstanceOf(IllegalTransactionStateException.class);
	}

	@Test
	@DisplayName("지난모임_날짜가지나도_지워지지않고그대로열린다")
	void pastMeetup_staysOpen() {
		String code = meetup(HOST, LocalDate.of(2026, 11, 14));
		clock.instant = NOON.plus(java.time.Duration.ofDays(120));

		MeetupSnapshot snapshot = meetupService.snapshot(code, HOST, null);

		assertThat(snapshot.afterMeetup()).isFalse();
		assertThat(snapshot.allowed()).contains(MeetupAction.EDIT_INFO);
		assertThat(profileService.create(code, null, new ProfileCreateRequest("하린", null)).maxAge())
				.isEqualTo(java.time.Duration.ofDays(365));
	}

	@Test
	@DisplayName("모임뒤_정한곳이있고모임날짜당일0시KST부터다")
	void afterMeetup_fromMeetDateMidnight() {
		String code = meetup(HOST, LocalDate.of(2026, 11, 14));
		profileService.create(code, HOST, new ProfileCreateRequest("민재", null));
		decide(code);

		clock.instant = Instant.parse("2026-11-13T14:59:59Z");
		MeetupSnapshot before = meetupService.snapshot(code, HOST, null);
		assertThat(before.afterMeetup()).isFalse();
		assertThat(before.allowed()).contains(MeetupAction.CHANGE_DECISION, MeetupAction.EDIT_TASTE);

		clock.instant = Instant.parse("2026-11-13T15:00:00Z");
		MeetupSnapshot after = meetupService.snapshot(code, HOST, null);
		assertThat(after.afterMeetup()).isTrue();
		assertThat(after.allowed()).isEmpty();
	}

	@Test
	@DisplayName("모임뒤_날짜가없으면_없고정한곳을계속바꿀수있다")
	void afterMeetup_withoutDate_never() {
		String code = meetup(HOST, null);
		decide(code);
		clock.instant = NOON.plus(java.time.Duration.ofDays(60));

		MeetupSnapshot snapshot = meetupService.snapshot(code, HOST, null);
		assertThat(snapshot.afterMeetup()).isFalse();
		assertThat(snapshot.allowed()).contains(MeetupAction.CHANGE_DECISION, MeetupAction.CANCEL_DECISION);
	}

	@Test
	@DisplayName("내모임_만든모임과회원으로참여한모임만이고_비회원으로참여한모임과남의모임은없다")
	void mine_hostedAndJoinedAsMember_only() {
		String joined = meetup(HOST, null);
		profileService.create(joined, MEMBER, new ProfileCreateRequest("도윤", null));
		String asGuest = meetup(HOST, null);
		profileService.create(asGuest, null, new ProfileCreateRequest("도윤", null));
		meetup(HOST, null);
		String own = meetup(MEMBER, null);

		List<MeetupListResponse.Item> items = listService.mine(MEMBER).items();

		assertThat(items).extracting(MeetupListResponse.Item::code).containsExactly(own, joined);
		assertThat(items).extracting(MeetupListResponse.Item::role)
				.containsExactly(MeetupRole.HOST, MeetupRole.PARTICIPANT);
		assertThat(items.get(1).profileCount()).isEqualTo(1);
	}

	@Test
	@DisplayName("내모임_진행중이먼저최근에만든순서이고_끝난모임은최근에정한순서이며정한곳이름이있다")
	void mine_ongoingFirst_thenDecidedByDecidedAt() {
		String first = meetup(HOST, LocalDate.of(2026, 11, 14));
		String waiting = meetup(HOST, null);
		String last = meetup(HOST, null);
		decide(first);
		clock.instant = NOON.plusSeconds(60);
		decide(last);

		List<MeetupListResponse.Item> items = listService.mine(HOST).items();

		assertThat(items).extracting(MeetupListResponse.Item::code).containsExactly(waiting, last, first);
		assertThat(items.get(0).decidedPlaceName()).isNull();
		assertThat(items.get(1).decidedPlaceName()).isEqualTo("탈퇴 테스트");
		assertThat(items.get(2).date()).isEqualTo(LocalDate.of(2026, 11, 14));
		assertThat(items.get(2).time()).isEqualTo("19:00");
	}

	@Test
	@DisplayName("내모임_탈퇴한회원이면_401이다")
	void mine_withdrawn_unauthorized() {
		userService.withdraw(MEMBER, new AuthUseCases.Identity(MEMBER, null, 0));

		assertThatThrownBy(() -> listService.mine(MEMBER)).isInstanceOf(AuthFailure.class);
	}

	private String meetup(String host, LocalDate date) {
		return meetupService.create(host, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), MeetupCategory.RESTAURANT, date,
				date == null ? null : LocalTime.of(19, 0), 4, null)).code();
	}

	private void decide(String code) {
		jdbc.update("""
				update meetups set phase = 'DECIDED', decided_place_id = 9121, decided_how = 'DIRECT', decided_at = ?
				where code = ?""", java.sql.Timestamp.from(clock.instant), code);
	}

	private void cleanUp() {
		jdbc.update("delete from meetups where host_user_id like ?", PREFIX + "%");
		jdbc.update("delete from auth_users where id like ?", PREFIX + "%");
		jdbc.update("delete from places where place_id = 9121");
	}

}
