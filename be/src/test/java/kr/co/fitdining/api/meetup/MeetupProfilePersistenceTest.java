package kr.co.fitdining.api.meetup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.meetup.domain.AreaKind;
import kr.co.fitdining.api.meetup.domain.FoodType;
import kr.co.fitdining.api.meetup.domain.MeetupAction;
import kr.co.fitdining.api.meetup.domain.MeetupCategory;
import kr.co.fitdining.api.meetup.domain.MeetupRole;
import kr.co.fitdining.api.meetup.domain.Mood;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupPreview;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException;
import kr.co.fitdining.api.meetup.exception.MeetupConflictException.Conflict;
import kr.co.fitdining.api.meetup.exception.MeetupForbiddenException;
import kr.co.fitdining.api.meetup.exception.MeetupNotFoundException;
import kr.co.fitdining.api.meetup.exception.MeetupProfileNotFoundException;
import kr.co.fitdining.api.meetup.exception.TooManyMeetupWritesException;
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
 * 실제 PostgreSQL과 Redis(Testcontainers)로 프로필 만들기·고르기, 취향 수정, 프로필 지우기, 요청한 사람 판정, 쓰기
 * 한도를 확인한다(AC-5 ~ AC-10, AC-13, AC-23). 이 테스트가 만든 회원, 장소, 모임은 앞뒤로 지운다.
 */
@SpringBootTest
@Import(MeetupProfilePersistenceTest.Configuration.class)
class MeetupProfilePersistenceTest extends PostgresTestSupport {

	/** 2026-11-11 12:00 KST */
	private static final Instant NOON = Instant.parse("2026-11-11T03:00:00Z");
	private static final String PREFIX = "meetup-profile-test-";
	private static final String HOST = PREFIX + "host";
	private static final String MEMBER = PREFIX + "member";
	private static final Taste FULL_TASTE = new Taste(Mood.QUIET, List.of(FoodType.KOREAN), List.of(FoodType.CHINESE),
			true, null, "곱창");

	@DynamicPropertySource
	static void placeCatalog(DynamicPropertyRegistry registry) {
		registry.add("place.mock.enabled", () -> "false");
	}

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock meetupProfileTestClock() {
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
	MeetupWriteLimiter writeLimiter;

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
				overriding system value values (9111, 'meetup-profile-test-9111', '프로필 테스트', 'RESTAURANT',
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
		jdbc.update("delete from places where place_id = 9111");
	}

	private String meetup(MeetupCategory category, Integer headcount) {
		return meetupService.create(HOST, new MeetupCreateRequest(
				new MeetupCreateRequest.Area(AreaKind.STATION, "선릉"), category, null, null, headcount, null)).code();
	}

	private MeetupProfileService.Joined join(String code, String userId, String name, Taste taste) {
		return profileService.create(code, userId, new ProfileCreateRequest(name, taste));
	}

	private Conflict conflictOf(Runnable action) {
		try {
			action.run();
		} catch (MeetupConflictException e) {
			return e.conflict();
		}
		return null;
	}

	@Nested
	@DisplayName("프로필 만들기")
	class Create {

		@Test
		@DisplayName("만들기_비회원이면_쿠키로자기프로필이되고DB에는쿠키해시만있다")
		void create_guest_cookieResolvesProfile() {
			String code = meetup(MeetupCategory.RESTAURANT, 4);
			MeetupProfileService.Joined joined = join(code, null, "하린", FULL_TASTE);

			MeetupSnapshot snapshot = meetupService.snapshot(code, null, joined.token());

			assertThat(snapshot.me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.PARTICIPANT, joined.profileId(), false,
					false, null));
			assertThat(snapshot.allowed()).containsExactly(MeetupAction.EDIT_TASTE);
			assertThat(snapshot.profiles()).singleElement().satisfies(profile -> {
				assertThat(profile.name()).isEqualTo("하린");
				assertThat(profile.member()).isFalse();
				assertThat(profile.taste()).isEqualTo(FULL_TASTE);
				assertThat(profile.reflected()).isFalse();
			});
			assertThat(snapshot.pendingCount()).isEqualTo(3);
			byte[] stored = jdbc.queryForObject("select token_hash from meetup_profile_sessions where profile_id = ?",
					byte[].class, joined.profileId());
			assertThat(stored).isEqualTo(MeetupRequesters.hash(joined.token())).hasSize(32);
			assertThat(joined.maxAge()).isEqualTo(Duration.ofDays(365));
		}

		@Test
		@DisplayName("만들기_모임장이면_회원이자모임장프로필이고참여동작이빠진다")
		void create_host_memberHostProfile() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined joined = join(code, HOST, "민재", null);

			MeetupSnapshot snapshot = meetupService.snapshot(code, HOST, null);

			assertThat(snapshot.me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.HOST, joined.profileId(), true, false, null));
			assertThat(snapshot.allowed()).contains(MeetupAction.EDIT_TASTE).doesNotContain(MeetupAction.JOIN);
			assertThat(snapshot.profiles()).singleElement().satisfies(profile -> {
				assertThat(profile.member()).isTrue();
				assertThat(profile.host()).isTrue();
				assertThat(profile.taste()).isNull();
			});
			assertThat(snapshot.pendingCount()).isNull();
		}

		@Test
		@DisplayName("만들기_공백과자모로풀린글자만다른이름은_이미있는이름이고대소문자는다르다")
		void create_sameNormalizedName_nameTaken() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			join(code, null, "민재", null);
			assertThat(conflictOf(() -> join(code, null, " 민재 ", null)))
					.isEqualTo(Conflict.NAME_TAKEN);
			join(code, null, "Jay", null);
			assertThatCode(() -> join(code, null, "jay", null)).doesNotThrowAnyException();
		}

		@Test
		@DisplayName("만들기_8명이면_9번째는다찼고색은모두다르다")
		void create_ninth_full() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			IntStream.range(0, 8).forEach(i -> join(code, null, "친구" + i, null));

			assertThat(conflictOf(() -> join(code, null, "늦은친구", null))).isEqualTo(Conflict.FULL);
			assertThat(jdbc.queryForList("""
					select color from meetup_profiles p join meetups m on m.meetup_id = p.meetup_id
					where m.code = ? order by color""", Integer.class, code)).containsExactly(0, 1, 2, 3, 4, 5, 6, 7);
		}

		@Test
		@DisplayName("만들기_이미참여한회원이면_409다")
		void create_memberTwice_alreadyJoined() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			join(code, MEMBER, "도윤", null);
			assertThat(conflictOf(() -> join(code, MEMBER, "도윤2", null))).isEqualTo(Conflict.ALREADY_JOINED);
		}

		@Test
		@DisplayName("만들기_같은이름이동시에오면_하나만만든다")
		void create_concurrentSameName_oneWins() throws Exception {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			CountDownLatch start = new CountDownLatch(1);
			Callable<Conflict> attempt = () -> {
				start.await();
				return conflictOf(() -> join(code, null, "하린", null));
			};
			ExecutorService pool = Executors.newFixedThreadPool(2);
			try {
				List<Future<Conflict>> results = new ArrayList<>(List.of(pool.submit(attempt), pool.submit(attempt)));
				start.countDown();
				List<Conflict> conflicts = new ArrayList<>();
				for (Future<Conflict> result : results) {
					conflicts.add(result.get());
				}
				assertThat(conflicts).containsExactlyInAnyOrder(null, Conflict.NAME_TAKEN);
			} finally {
				pool.shutdownNow();
			}
		}

		@Test
		@DisplayName("만들기_보이지않는질문의답은_저장하지않는다")
		void create_hiddenAnswers_notStored() {
			String code = meetup(MeetupCategory.CAFE, null);
			MeetupProfileService.Joined joined = join(code, null, "하린", FULL_TASTE);

			Map<String, Object> row = jdbc.queryForMap(
					"select mood, like_foods, no_spicy, want_menu from meetup_profiles where profile_id = ?",
					joined.profileId());
			assertThat(row).containsEntry("mood", "QUIET").containsEntry("like_foods", null)
					.containsEntry("no_spicy", null).containsEntry("want_menu", null);
		}

	}

	@Nested
	@DisplayName("취향 수정과 프로필 고르기")
	class UpdateAndSelect {

		@Test
		@DisplayName("취향수정_보이는답만바꾸고_숨겨진답은지킨다")
		void updateTaste_keepsHiddenAnswers() {
			String code = meetup(MeetupCategory.CAFE, null);
			MeetupProfileService.Joined joined = join(code, null, "하린", null);
			jdbc.update("update meetup_profiles set like_foods = '{KOREAN}', want_menu = '곱창' where profile_id = ?",
					joined.profileId());
			clock.instant = NOON.plusSeconds(60);

			profileService.updateTaste(code, null, joined.token(), new Taste(Mood.LIVELY, null, null, null, null, null));

			Map<String, Object> row = jdbc.queryForMap(
					"select mood, want_menu, taste_updated_at from meetup_profiles where profile_id = ?",
					joined.profileId());
			assertThat(row).containsEntry("mood", "LIVELY").containsEntry("want_menu", "곱창");
			assertThat(((java.sql.Timestamp) row.get("taste_updated_at")).toInstant()).isEqualTo(NOON.plusSeconds(60));
		}

		@Test
		@DisplayName("취향수정_프로필이없으면_403이다")
		void updateTaste_withoutProfile_forbidden() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			assertThatThrownBy(() -> profileService.updateTaste(code, null, "unknown-token", Taste.EMPTY))
					.isInstanceOf(MeetupForbiddenException.class);
		}

		@Test
		@DisplayName("고르기_비회원프로필은누구나고르고_회원프로필은그회원만고른다")
		void select_guestAnyone_memberOwnerOnly() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined guest = join(code, null, "하린", null);
			MeetupProfileService.Joined member = join(code, MEMBER, "도윤", null);

			MeetupProfileService.Joined again = profileService.select(code, guest.profileId(), null);
			assertThat(meetupService.snapshot(code, null, again.token()).me().profileId()).isEqualTo(guest.profileId());
			assertThatThrownBy(() -> profileService.select(code, member.profileId(), null))
					.isInstanceOf(MeetupForbiddenException.class);
			assertThatThrownBy(() -> profileService.select(code, member.profileId(), HOST))
					.isInstanceOf(MeetupForbiddenException.class);
			assertThatCode(() -> profileService.select(code, member.profileId(), MEMBER)).doesNotThrowAnyException();
			assertThatThrownBy(() -> profileService.select(code, 999_999L, null))
					.isInstanceOf(MeetupProfileNotFoundException.class);
		}

		@Test
		@DisplayName("판정_회원프로필을가리키는쿠키는_그회원으로로그인했을때만인정한다")
		void resolve_memberCookie_onlyForThatMember() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined member = join(code, MEMBER, "도윤", null);

			assertThat(meetupService.snapshot(code, null, member.token()).me().role()).isEqualTo(MeetupRole.VIEWER);
			assertThat(meetupService.snapshot(code, HOST, member.token()).me().profileId()).isNull();
			assertThat(meetupService.snapshot(code, MEMBER, member.token()).me().profileId())
					.isEqualTo(member.profileId());
		}

		@Test
		@DisplayName("판정_로그인한회원의쿠키가비회원프로필이면_그프로필이고회원프로필로바꿀수있다")
		void resolve_guestCookieWithMember_convertible() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined guest = join(code, null, "하린", null);

			MeetupSnapshot snapshot = meetupService.snapshot(code, MEMBER, guest.token());

			assertThat(snapshot.me()).isEqualTo(new MeetupSnapshot.Me(MeetupRole.PARTICIPANT, guest.profileId(), true,
					false, true));
			assertThat(snapshot.allowed()).containsExactly(MeetupAction.EDIT_TASTE, MeetupAction.LINK_ACCOUNT);
		}

		@Test
		@DisplayName("회원프로필로바꾸기_쿠키의비회원프로필이그회원의프로필이되고_모임취향은그대로다")
		void linkAccount_guestBecomesMember_tasteKept() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined guest = join(code, null, "하린", FULL_TASTE);

			profileService.linkAccount(code, MEMBER, guest.token());

			MeetupSnapshot snapshot = meetupService.snapshot(code, MEMBER, null);
			assertThat(snapshot.me().profileId()).isEqualTo(guest.profileId());
			assertThat(snapshot.me().convertible()).isNull();
			assertThat(snapshot.allowed()).doesNotContain(MeetupAction.LINK_ACCOUNT);
			MeetupSnapshot.Profile profile = snapshot.profiles().stream()
					.filter(item -> item.id() == guest.profileId()).findFirst().orElseThrow();
			assertThat(profile.member()).isTrue();
			assertThat(profile.taste()).isEqualTo(FULL_TASTE);
			assertThat(jdbc.queryForObject("select count(*) from user_preferences where user_id = ?", Integer.class,
					MEMBER)).isZero();
		}

		@Test
		@DisplayName("회원프로필로바꾸기_이미이모임에프로필이있으면409이고_쿠키가비회원프로필이아니면403이다")
		void linkAccount_rejected() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined guest = join(code, null, "하린", null);
			MeetupProfileService.Joined member = join(code, MEMBER, "도윤", null);

			assertThat(conflictOf(() -> profileService.linkAccount(code, MEMBER, guest.token())))
					.isEqualTo(Conflict.ALREADY_JOINED);
			assertThatThrownBy(() -> profileService.linkAccount(code, HOST, null))
					.isInstanceOf(MeetupForbiddenException.class);
			assertThatThrownBy(() -> profileService.linkAccount(code, HOST, member.token()))
					.isInstanceOf(MeetupForbiddenException.class);
		}

		@Test
		@DisplayName("미리보기_모임장닉네임과지역과날짜시간만주고_없는코드는404다")
		void preview_onlyPublicInfo() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			join(code, null, "하린", FULL_TASTE);

			MeetupPreview preview = meetupService.preview(code);

			assertThat(preview.hostNickname()).isNotBlank();
			assertThat(preview.area()).isEqualTo(new MeetupPreview.Area(AreaKind.STATION, "선릉"));
			assertThatThrownBy(() -> meetupService.preview("AAAAAAAAAAAAAAAAAAAAAA"))
					.isInstanceOf(MeetupNotFoundException.class);
		}

	}

	@Nested
	@DisplayName("프로필 지우기")
	class Remove {

		@Test
		@DisplayName("지우기_모임장이면_프로필과쿠키세션이함께지워진다")
		void remove_host_deletesProfileAndSessions() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined guest = join(code, null, "하린", null);

			profileService.remove(code, HOST, guest.profileId());

			assertThat(jdbc.queryForObject("select count(*) from meetup_profile_sessions where profile_id = ?",
					Integer.class, guest.profileId())).isZero();
			assertThat(meetupService.snapshot(code, null, guest.token()).me().role()).isEqualTo(MeetupRole.VIEWER);
		}

		@Test
		@DisplayName("지우기_모임장이아니면403_모임장자신이면409_없는프로필이면404다")
		void remove_rejections() {
			String code = meetup(MeetupCategory.RESTAURANT, null);
			MeetupProfileService.Joined host = join(code, HOST, "민재", null);
			MeetupProfileService.Joined guest = join(code, null, "하린", null);

			assertThatThrownBy(() -> profileService.remove(code, MEMBER, guest.profileId()))
					.isInstanceOf(MeetupForbiddenException.class);
			assertThat(conflictOf(() -> profileService.remove(code, HOST, host.profileId())))
					.isEqualTo(Conflict.HOST_PROFILE);
			assertThatThrownBy(() -> profileService.remove(code, HOST, 999_999L))
					.isInstanceOf(MeetupProfileNotFoundException.class);
		}

	}

	@Nested
	@DisplayName("쓰기 한도")
	class WriteLimit {

		@Test
		@DisplayName("한도_모임과주소마다15분에120번까지이고_다음구간에서다시센다")
		void count_perMeetupAndAddress() {
			String code = "LimitTestCode" + System.nanoTime() % 1_000_000_000L;
			IntStream.range(0, 120).forEach(i -> writeLimiter.count(code, "10.0.0.1"));

			assertThatThrownBy(() -> writeLimiter.count(code, "10.0.0.1"))
					.isInstanceOf(TooManyMeetupWritesException.class);
			assertThatCode(() -> writeLimiter.count(code, "10.0.0.2")).doesNotThrowAnyException();
			assertThatCode(() -> writeLimiter.count(code + "x", "10.0.0.1")).doesNotThrowAnyException();
			clock.instant = NOON.plus(Duration.ofMinutes(15));
			assertThatCode(() -> writeLimiter.count(code, "10.0.0.1")).doesNotThrowAnyException();
		}

	}

}
