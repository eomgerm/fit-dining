package kr.co.fitdining.api.bookmark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.bookmark.dto.BookmarkItem;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.OpenStatus;
import kr.co.fitdining.api.place.dto.PlaceDetailResponse;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.place.dto.PlaceSummary.Station;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.support.PostgresTestSupport;
import kr.co.fitdining.api.user.UserService;
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
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 실제 PostgreSQL(Testcontainers)과 마이그레이션 위에서 북마크 서비스를 직접 불러 유일성, 저장 시각, 정렬, 사용자 격리,
 * 탈퇴 판정 순서, 장소 조회 결과 처리를 확인한다. 장소 조회는 대역이라 호출 여부와 실패를 정할 수 있다.
 * 컨테이너는 다른 통합 테스트와 함께 쓰므로 북마크와 이 테스트가 만든 사용자는 앞뒤로 지운다.
 */
// 장소 조회 대역 때문에 컨텍스트를 따로 만든다. 공유 컨테이너의 연결 수를 넘지 않게 풀을 줄인다
@SpringBootTest(properties = "spring.datasource.hikari.maximum-pool-size=3")
@Import(BookmarkPersistenceTest.Configuration.class)
class BookmarkPersistenceTest extends PostgresTestSupport {

	/** 2026-10-29 12:00:00.123456789 KST. 나노초가 있어 마이크로초 절사를 확인할 수 있다. */
	private static final Instant NOON = Instant.parse("2026-10-29T03:00:00.123456789Z");
	private static final String USER_PREFIX = "bookmark-test-";
	/** 테스트가 쓰는 장소 id. 장소 FK(V14)가 장소 행을 요구해 넣는다. 다른 테스트가 같은 id를 넣었으면 그 행을 쓴다. */
	private static final List<Long> PLACE_IDS = List.of(3L, 4L, 5L, 7L, 9L);
	/** 장소 삭제 확인에만 쓰는 장소 id. 다른 테스트와 겹치지 않는 값이다. */
	private static final long DELETABLE_PLACE_ID = 900_001L;

	@TestConfiguration
	static class Configuration {
		@Bean
		@Primary
		MutableClock bookmarkTestClock() {
			return new MutableClock();
		}
	}

	/** 운영 시계처럼 UTC다. */
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
	BookmarkService service;

	@Autowired
	AuthUserRepository users;

	@Autowired
	UserService userService;

	@Autowired
	MutableClock clock;

	@MockitoBean
	PlaceService places;

	private JdbcTemplate jdbc;

	@BeforeEach
	void setUp() {
		jdbc = new JdbcTemplate(appSource());
		cleanUp();
		clock.instant = NOON;
		PLACE_IDS.forEach(this::insertPlace);
		when(places.getPlace(anyLong())).thenAnswer(call -> detail(call.getArgument(0)));
	}

	private void insertPlace(long placeId) {
		jdbc.update("""
				insert into places (place_id, naver_place_id, name, category_group, station, lat, lng)
				overriding system value values (?, ?, ?, 'CAFE', 'YEOKSAM', 37.5, 127.03)
				on conflict do nothing""", placeId, USER_PREFIX + placeId, "북마크 테스트 장소 " + placeId);
	}

	@AfterEach
	void cleanUp() {
		JdbcTemplate app = new JdbcTemplate(appSource());
		app.update("delete from bookmarks");
		app.update("delete from places where naver_place_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_refresh_tokens where user_id like ?", USER_PREFIX + "%");
		app.update("delete from auth_users where id like ?", USER_PREFIX + "%");
	}

	private List<String> createUsers(int count) {
		List<AuthUser> created = IntStream.range(0, count)
				.mapToObj(i -> new AuthUser(USER_PREFIX + i, USER_PREFIX + i + "@example.com", "북마크테스트" + i,
						"not-a-real-hash", NOON, "2026-10-23"))
				.toList();
		users.saveAll(created);
		return created.stream().map(AuthUser::getId).toList();
	}

	private String createUser() {
		return createUsers(1).getFirst();
	}

	private void withdraw(String userId) {
		userService.withdraw(userId, new AuthUseCases.Identity(userId, null, null, 0, 0));
	}

	private static PlaceDetailResponse detail(long id) {
		return new PlaceDetailResponse(
				new PlaceSummary(id, "장소" + id, CategoryGroup.CAFE, Station.YEOKSAM, 37.5, 127.03, null),
				"서울 강남구 역삼로 " + id, List.of("조용한 곳", "자리가 넉넉한 곳"), List.of(), null, null, OpenStatus.OPEN,
				List.of(), null, List.of(), List.of(), List.of(), null, null, null, false, null, null, List.of(), null,
				List.of(), List.of(), List.of());
	}

	private int rows() {
		return jdbc.queryForObject("select count(*) from bookmarks", Integer.class);
	}

	private Instant savedAt(String userId, long placeId) {
		return jdbc.queryForObject("select created_at from bookmarks where user_id = ? and place_id = ?",
				java.sql.Timestamp.class, userId, placeId).toInstant();
	}

	private static List<Long> ids(List<BookmarkItem> items) {
		return items.stream().map(item -> item.place().id()).toList();
	}

	@Nested
	@DisplayName("장소 FK")
	class PlaceForeignKey {

		@Test
		@DisplayName("저장_확인뒤장소가없어FK에걸리면_404예외이고행이생기지않는다")
		void save_placeMissingAtInsert_throwsNotFoundWithoutRow() {
			String user = createUser();
			long missing = 888_888L;

			assertThatThrownBy(() -> service.save(user, missing)).isInstanceOf(PlaceNotFoundException.class);
			assertThat(rows()).isZero();
			verify(places).getPlace(missing);
		}

		@Test
		@DisplayName("장소삭제_그장소의북마크만지워지고다른장소북마크는남는다")
		void deletePlace_removesOnlyItsBookmarks() {
			insertPlace(DELETABLE_PLACE_ID);
			List<String> users = createUsers(2);
			service.save(users.get(0), DELETABLE_PLACE_ID);
			service.save(users.get(1), DELETABLE_PLACE_ID);
			service.save(users.get(0), 3);

			jdbc.update("delete from places where place_id = ?", DELETABLE_PLACE_ID);

			assertThat(rows()).isEqualTo(1);
			assertThat(service.isBookmarked(users.get(0), 3)).isTrue();
		}

		@Test
		@DisplayName("제약_장소FK는places를가리키고장소삭제때함께지운다")
		void constraint_referencesPlacesWithCascade() {
			var fk = jdbc.queryForMap("""
					SELECT confrelid::regclass::text AS target, confdeltype::text AS on_delete
					FROM pg_constraint WHERE conname = ?""", BookmarkService.PLACE_CONSTRAINT);

			assertThat(fk.get("target")).isEqualTo("places");
			assertThat(fk.get("on_delete")).isEqualTo("c");
		}
	}

	@Nested
	@DisplayName("저장")
	class Save {

		@Test
		@DisplayName("저장_장소가있으면_행하나를만들고저장시각은시계값을마이크로초로자른다")
		void save_existingPlace_insertsRowWithClockTime() {
			String user = createUser();

			service.save(user, 3);

			assertThat(rows()).isEqualTo(1);
			assertThat(savedAt(user, 3)).isEqualTo(Instant.parse("2026-10-29T03:00:00.123456Z"));
			verify(places).getPlace(3);
		}

		@Test
		@DisplayName("저장_장소가없으면_404예외이고행이생기지않는다")
		void save_missingPlace_throwsNotFoundWithoutRow() {
			String user = createUser();
			when(places.getPlace(9)).thenThrow(new PlaceNotFoundException());

			assertThatThrownBy(() -> service.save(user, 9)).isInstanceOf(PlaceNotFoundException.class);
			assertThat(rows()).isZero();
		}

		@Test
		@DisplayName("저장_장소엔진이없으면_503예외이고행이생기지않는다")
		void save_noEngine_throwsUnavailableWithoutRow() {
			String user = createUser();
			when(places.getPlace(3)).thenThrow(new PlaceSearchUnavailableException());

			assertThatThrownBy(() -> service.save(user, 3)).isInstanceOf(PlaceSearchUnavailableException.class);
			assertThat(rows()).isZero();
		}

		@Test
		@DisplayName("저장_이미저장한장소면_장소엔진을부르지않고저장시각과순서를바꾸지않는다")
		void save_alreadySaved_skipsPlaceLookupAndKeepsTime() {
			String user = createUser();
			service.save(user, 3);
			clock.instant = NOON.plusSeconds(60);
			service.save(user, 4);
			clock.instant = NOON.plusSeconds(120);
			when(places.getPlace(3)).thenThrow(new PlaceSearchUnavailableException());

			service.save(user, 3);

			assertThat(rows()).isEqualTo(2);
			assertThat(savedAt(user, 3)).isEqualTo(Instant.parse("2026-10-29T03:00:00.123456Z"));
			doAnswer(call -> detail(3)).when(places).getPlace(3);
			assertThat(ids(service.list(user))).containsExactly(4L, 3L);
		}

		@Test
		@DisplayName("저장_이미저장한장소가지금404여도_204처럼성공한다")
		void save_alreadySavedButPlaceGone_succeeds() {
			String user = createUser();
			service.save(user, 3);
			when(places.getPlace(3)).thenThrow(new PlaceNotFoundException());

			service.save(user, 3);

			assertThat(rows()).isEqualTo(1);
		}

		@Test
		@DisplayName("저장_같은장소를동시에여러번_모두성공하고행하나이며저장시각은바뀌지않는다")
		void save_concurrentSameKey_allSucceedWithOneRow() throws Exception {
			String user = createUser();
			int threads = 8;
			CountDownLatch start = new CountDownLatch(1);
			ExecutorService pool = Executors.newFixedThreadPool(threads);
			try {
				List<Future<Void>> results = new ArrayList<>();
				for (int i = 0; i < threads; i++) {
					Callable<Void> call = () -> {
						start.await();
						service.save(user, 3);
						return null;
					};
					results.add(pool.submit(call));
				}
				start.countDown();
				for (Future<Void> result : results) {
					result.get();
				}
			} finally {
				pool.shutdownNow();
			}
			Instant first = savedAt(user, 3);
			clock.instant = NOON.plusSeconds(600);

			service.save(user, 3);

			assertThat(rows()).isEqualTo(1);
			assertThat(savedAt(user, 3)).isEqualTo(first);
		}

	}

	@Nested
	@DisplayName("해제")
	class Remove {

		@Test
		@DisplayName("해제_저장한장소면_행을지운다")
		void remove_saved_deletesRow() {
			String user = createUser();
			service.save(user, 3);

			service.remove(user, 3);

			assertThat(rows()).isZero();
			assertThat(service.isBookmarked(user, 3)).isFalse();
		}

		@Test
		@DisplayName("해제_저장하지않은장소여도_성공하고장소엔진을부르지않는다")
		void remove_notSaved_succeedsWithoutPlaceLookup() {
			String user = createUser();
			when(places.getPlace(anyLong())).thenThrow(new PlaceSearchUnavailableException());

			service.remove(user, 3);
			service.remove(user, 3);

			verify(places, never()).getPlace(anyLong());
		}

		@Test
		@DisplayName("해제_엔진이없어도_저장한행을지운다")
		void remove_noEngine_stillDeletes() {
			String user = createUser();
			service.save(user, 3);
			when(places.getPlace(anyLong())).thenThrow(new PlaceSearchUnavailableException());

			service.remove(user, 3);

			assertThat(rows()).isZero();
		}

	}

	@Nested
	@DisplayName("저장 여부")
	class Status {

		@Test
		@DisplayName("저장여부_북마크테이블만보고_장소엔진을부르지않는다")
		void isBookmarked_noEngine_readsTableOnly() {
			String user = createUser();
			service.save(user, 3);
			when(places.getPlace(anyLong())).thenThrow(new PlaceSearchUnavailableException());

			assertThat(service.isBookmarked(user, 3)).isTrue();
			assertThat(service.isBookmarked(user, 4)).isFalse();
			verify(places, never()).getPlace(4);
		}

	}

	@Nested
	@DisplayName("내 목록")
	class ListBookmarks {

		@Test
		@DisplayName("목록_저장시각최신순이고같은시각이면장소id내림차순이다")
		void list_savedAtTies_returnsNewestFirstThenPlaceIdDesc() {
			String user = createUser();
			service.save(user, 3);
			service.save(user, 7);
			clock.instant = NOON.plusSeconds(60);
			service.save(user, 5);

			assertThat(ids(service.list(user))).containsExactly(5L, 7L, 3L);
		}

		@Test
		@DisplayName("목록_해제뒤다시저장하면_새저장시각으로맨앞에온다")
		void list_resaveAfterRemove_movesToFront() {
			String user = createUser();
			service.save(user, 3);
			clock.instant = NOON.plusSeconds(60);
			service.save(user, 4);
			service.remove(user, 3);
			clock.instant = NOON.plusSeconds(120);

			service.save(user, 3);

			assertThat(ids(service.list(user))).containsExactly(3L, 4L);
		}

		@Test
		@DisplayName("목록_항목은장소상세의요약주소태그영업상태와KST저장시각이다")
		void list_savedPlace_returnsPlaceFieldsAndKstSavedAt() {
			String user = createUser();
			clock.instant = Instant.parse("2026-10-29T15:30:00.123456789Z");
			service.save(user, 3);

			BookmarkItem item = service.list(user).getFirst();

			assertThat(item.place()).isEqualTo(detail(3).place());
			assertThat(item.address()).isEqualTo("서울 강남구 역삼로 3");
			assertThat(item.tags()).containsExactly("조용한 곳", "자리가 넉넉한 곳");
			assertThat(item.openStatus()).isEqualTo(OpenStatus.OPEN);
			assertThat(item.savedAt().toString()).isEqualTo("2026-10-30T00:30:00.123456+09:00");
		}

		@Test
		@DisplayName("목록_장소의태그가없으면_빈배열이다")
		void list_placeWithoutTags_returnsEmptyTags() {
			String user = createUser();
			PlaceDetailResponse base = detail(3);
			when(places.getPlace(3)).thenReturn(new PlaceDetailResponse(base.place(), null, null, List.of(), null,
					null, OpenStatus.UNKNOWN, List.of(), null, List.of(), List.of(), List.of(), null, null, null, false,
					null, null, List.of(), null, List.of(), List.of(), List.of()));
			service.save(user, 3);

			BookmarkItem item = service.list(user).getFirst();

			assertThat(item.tags()).isEmpty();
			assertThat(item.address()).isNull();
		}

		@Test
		@DisplayName("목록_장소조회가404인북마크는_빠지고행은남는다")
		void list_placeNotFound_skipsItemAndKeepsRow() {
			String user = createUser();
			service.save(user, 3);
			service.save(user, 4);
			when(places.getPlace(3)).thenThrow(new PlaceNotFoundException());

			assertThat(ids(service.list(user))).containsExactly(4L);
			assertThat(rows()).isEqualTo(2);
		}

		@Test
		@DisplayName("목록_엔진이없으면_목록전체가503예외다")
		void list_noEngine_throwsUnavailable() {
			String user = createUser();
			service.save(user, 3);
			service.save(user, 4);
			when(places.getPlace(4)).thenThrow(new PlaceSearchUnavailableException());

			assertThatThrownBy(() -> service.list(user)).isInstanceOf(PlaceSearchUnavailableException.class);
		}

		@Test
		@DisplayName("목록_예상하지못한장소조회오류면_목록전체가실패한다")
		void list_unexpectedFailure_throwsWholeList() {
			String user = createUser();
			service.save(user, 3);
			service.save(user, 4);
			when(places.getPlace(3)).thenThrow(new IllegalStateException("boom"));

			assertThatThrownBy(() -> service.list(user)).isInstanceOf(IllegalStateException.class);
		}

		@Test
		@DisplayName("목록_저장한장소가없으면_장소엔진을부르지않고빈목록이다")
		void list_empty_skipsPlaceLookup() {
			String user = createUser();
			when(places.getPlace(anyLong())).thenThrow(new PlaceSearchUnavailableException());

			assertThat(service.list(user)).isEmpty();
			verify(places, never()).getPlace(anyLong());
		}

	}

	@Nested
	@DisplayName("사용자 격리")
	class Isolation {

		@Test
		@DisplayName("격리_두사용자가섞어저장해제해도_각자의것만보이고바뀐다")
		void saveRemoveListStatus_twoUsersMixed_affectOnlyOwnRows() {
			List<String> both = createUsers(2);
			String a = both.get(0);
			String b = both.get(1);
			service.save(a, 3);
			service.save(b, 4);
			service.save(a, 4);
			service.remove(a, 4);
			service.remove(a, 5);
			service.save(b, 5);
			service.remove(b, 3);

			assertThat(ids(service.list(a))).containsExactly(3L);
			assertThat(ids(service.list(b))).containsExactly(5L, 4L);
			assertThat(service.isBookmarked(b, 3)).isFalse();
			assertThat(service.isBookmarked(a, 5)).isFalse();
			assertThat(service.isBookmarked(b, 4)).isTrue();
		}

	}

	@Nested
	@DisplayName("탈퇴")
	class Withdrawn {

		@Test
		@DisplayName("탈퇴_탈퇴한사용자는_네기능모두장소확인전에401이다")
		void allOperations_withdrawnUser_throwAuthFailureBeforePlaceLookup() {
			String user = createUser();
			service.save(user, 3);
			withdraw(user);
			clearInvocations(places);
			when(places.getPlace(anyLong())).thenThrow(new PlaceNotFoundException());

			assertThatThrownBy(() -> service.list(user)).isInstanceOf(AuthFailure.class);
			assertThatThrownBy(() -> service.isBookmarked(user, 3)).isInstanceOf(AuthFailure.class);
			assertThatThrownBy(() -> service.save(user, 9)).isInstanceOf(AuthFailure.class);
			assertThatThrownBy(() -> service.remove(user, 3)).isInstanceOf(AuthFailure.class);
			verify(places, never()).getPlace(anyLong());
		}

		@Test
		@DisplayName("탈퇴_엔진이없어도_404503이아니라401이다")
		void save_withdrawnUserAndNoEngine_throwsUnauthorized() {
			String user = createUser();
			withdraw(user);
			when(places.getPlace(anyLong())).thenThrow(new PlaceSearchUnavailableException());

			assertThatThrownBy(() -> service.save(user, 3)).isInstanceOf(AuthFailure.class)
					.extracting(failure -> ((AuthFailure) failure).status()).isEqualTo(401);
		}

		@Test
		@DisplayName("탈퇴_회원탈퇴는_북마크행을지우지않는다")
		void withdraw_userWithBookmarks_keepsRows() {
			String user = createUser();
			service.save(user, 3);
			service.save(user, 4);

			withdraw(user);

			assertThat(rows()).isEqualTo(2);
		}

	}

}
