package kr.co.fitdining.api.place.keyword;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.ReentrantLock;
import kr.co.fitdining.api.place.catalog.PlaceSearchDocument;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class DocumentKeywordSearchTest extends PlaceKeywordSearchContract {

	@Override
	protected PlaceKeywordSearch create(List<PlaceSearchDocument> documents) {
		return new DocumentKeywordSearch(new FakePlaceCatalog(documents), Optional.empty());
	}

	/** 시간을 직접 옮기는 시계. */
	private static final class TestClock extends Clock {

		private volatile Instant now = Instant.parse("2026-10-29T00:00:00Z");

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
			return now;
		}

		void advance(Duration duration) {
			now = now.plus(duration);
		}

	}

	private final TestClock clock = new TestClock();
	private final FakePlaceCatalog catalog = new FakePlaceCatalog(CATALOG);
	private final DocumentKeywordSearch search = new DocumentKeywordSearch(catalog, Optional.of(clock));

	private static void await(CountDownLatch latch) {
		try {
			if (!latch.await(5, TimeUnit.SECONDS)) {
				throw new IllegalStateException("latch timeout");
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException(e);
		}
	}

	/** 만든 thread를 순서대로 모아 둔다. 고정 크기 pool은 submit마다 새 thread를 만들므로 i번째 thread가 i번째 작업을 돈다 */
	private static final class RecordingThreads implements ThreadFactory {
		final List<Thread> threads = new CopyOnWriteArrayList<>();

		@Override
		public Thread newThread(Runnable task) {
			Thread thread = new Thread(task);
			threads.add(thread);
			return thread;
		}
	}

	/** 그 thread가 스냅샷 읽기 잠금({@code ReentrantLock})을 기다리며 멈출 때까지 기다린다. 5초 안에 멈추지 않으면 실패한다 */
	private static void awaitWaitingOnLock(Thread thread) throws InterruptedException {
		long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
		while (!waitingOnLock(thread)) {
			if (System.nanoTime() > deadline) {
				throw new AssertionError("잠금을 기다리지 않는다: " + thread.getState());
			}
			Thread.sleep(5);
		}
	}

	private static boolean waitingOnLock(Thread thread) {
		Thread.State state = thread.getState();
		return (state == Thread.State.WAITING || state == Thread.State.BLOCKED)
				&& Arrays.stream(thread.getStackTrace())
						.anyMatch(frame -> frame.getClassName().startsWith(ReentrantLock.class.getName()));
	}

	@Test
	@DisplayName("스냅샷_여러번검색해도_문서는한번만읽는다")
	void search_repeatedCalls_loadsDocumentsOnce() {
		search.search("쌀국수", 0, 5);
		search.search("식당", 0, 5);

		assertThat(catalog.loads).hasValue(1);
	}

	@Test
	@DisplayName("스냅샷_60초가지난뒤처음오는요청이_다시읽는다")
	void search_afterRefreshInterval_loadsAgain() {
		search.search("쌀국수", 0, 5);

		clock.advance(Duration.ofSeconds(59));
		search.search("쌀국수", 0, 5);
		assertThat(catalog.loads).hasValue(1);

		clock.advance(Duration.ofSeconds(2));
		search.search("쌀국수", 0, 5);
		assertThat(catalog.loads).hasValue(2);
	}

	@Test
	@DisplayName("스냅샷_읽은지정확히60초가되면_그요청이다시읽는다")
	void search_exactlyAtRefreshInterval_loadsAgain() {
		search.search("쌀국수", 0, 5);

		clock.advance(Duration.ofSeconds(60));
		search.search("쌀국수", 0, 5);

		assertThat(catalog.loads).hasValue(2);
	}

	@Test
	@DisplayName("스냅샷_락을잡는사이다른요청이이미갱신했으면_다시읽지않는다")
	void search_refreshedByAnotherRequestBeforeLock_doesNotLoadAgain() {
		AtomicReference<Runnable> onNextInstant = new AtomicReference<>();
		// 만료를 본 요청이 락을 잡기 전에, 다른 요청이 갱신을 끝낸 상황을 만든다. 만료 판정에 쓴 시각을 돌려주기 직전에
		// 같은 스레드에서 다른 요청의 갱신을 먼저 실행한다.
		Clock hooked = new Clock() {
			@Override
			public ZoneId getZone() {
				return clock.getZone();
			}

			@Override
			public Clock withZone(ZoneId zone) {
				return this;
			}

			@Override
			public Instant instant() {
				Instant now = clock.instant();
				Runnable hook = onNextInstant.getAndSet(null);
				if (hook != null) {
					hook.run();
				}
				return now;
			}
		};
		DocumentKeywordSearch hookedSearch = new DocumentKeywordSearch(catalog, Optional.of(hooked));
		hookedSearch.search("쌀국수", 0, 5);
		clock.advance(Duration.ofSeconds(61));
		onNextInstant.set(() -> hookedSearch.search("쌀국수", 0, 5));

		hookedSearch.search("쌀국수", 0, 5);

		assertThat(catalog.loads).hasValue(2);
	}

	@Test
	@DisplayName("스냅샷_갱신에실패하면_마지막스냅샷으로응답하고5초뒤에다시시도한다")
	void search_refreshFails_keepsServingLastSnapshotAndRetriesAfterBackoff() {
		List<PlaceKeywordHit> before = search.search("쌀국수", 0, 5);
		catalog.source = () -> {
			throw new IllegalStateException("db down");
		};
		clock.advance(Duration.ofSeconds(61));

		assertThat(search.search("쌀국수", 0, 5)).isEqualTo(before);
		assertThat(catalog.loads).hasValue(2);

		// 실패 직후의 요청은 DB를 다시 부르지 않고 마지막 스냅샷으로 응답한다.
		assertThat(search.search("쌀국수", 0, 5)).isEqualTo(before);
		assertThat(catalog.loads).hasValue(2);

		clock.advance(Duration.ofSeconds(5));
		assertThat(search.search("쌀국수", 0, 5)).isEqualTo(before);
		assertThat(catalog.loads).hasValue(3);
	}

	@Test
	@DisplayName("스냅샷_한번도읽지못했으면_503예외이고5초뒤에다시읽어복구한다")
	void search_neverLoaded_throwsUnavailableThenRecoversAfterBackoff() {
		catalog.source = () -> {
			throw new IllegalStateException("db down");
		};

		assertThatThrownBy(() -> search.search("쌀국수", 0, 5)).isInstanceOf(PlaceSearchUnavailableException.class);
		assertThat(catalog.loads).hasValue(1);

		// 실패 직후에는 DB를 다시 부르지 않고 바로 503이다.
		catalog.source = () -> CATALOG;
		assertThatThrownBy(() -> search.search("쌀국수", 0, 5)).isInstanceOf(PlaceSearchUnavailableException.class);
		assertThat(catalog.loads).hasValue(1);

		clock.advance(Duration.ofSeconds(5));
		assertThat(search.search("쌀국수", 0, 5)).isNotEmpty();
		assertThat(catalog.loads).hasValue(2);
	}

	@Test
	@DisplayName("스냅샷_최초읽기가실패하면_기다리던요청은_다시읽지않고함께503이다")
	void search_firstLoadFails_waitingRequestsFailTogetherWithoutReloading() throws Exception {
		CountDownLatch entered = new CountDownLatch(1);
		CountDownLatch gate = new CountDownLatch(1);
		catalog.source = () -> {
			entered.countDown();
			await(gate);
			throw new IllegalStateException("db down");
		};
		RecordingThreads threads = new RecordingThreads();
		ExecutorService executor = Executors.newFixedThreadPool(3, threads);
		try {
			Future<List<PlaceKeywordHit>> first = executor.submit(() -> search.search("쌀국수", 0, 5));
			await(entered);
			Future<List<PlaceKeywordHit>> second = executor.submit(() -> search.search("쌀국수", 0, 5));
			Future<List<PlaceKeywordHit>> third = executor.submit(() -> search.search("쌀국수", 0, 5));
			// 두 요청이 최초 읽기의 잠금 앞에서 기다리는 것을 확인한 뒤 실패시킨다
			awaitWaitingOnLock(threads.threads.get(1));
			awaitWaitingOnLock(threads.threads.get(2));

			gate.countDown();
			for (Future<List<PlaceKeywordHit>> request : List.of(first, second, third)) {
				assertThatThrownBy(() -> request.get(5, TimeUnit.SECONDS)).hasCauseInstanceOf(
						PlaceSearchUnavailableException.class);
			}
			// 기다리던 요청이 차례로 DB를 다시 부르면 3번이다.
			assertThat(catalog.loads).hasValue(1);
		} finally {
			gate.countDown();
			executor.shutdownNow();
		}
	}

	@Test
	@DisplayName("스냅샷_갱신중에다른요청이오면_기다리지않고기존스냅샷으로응답한다")
	void search_refreshInProgress_otherRequestUsesStaleSnapshot() throws Exception {
		search.search("쌀국수", 0, 5);
		CountDownLatch entered = new CountDownLatch(1);
		CountDownLatch gate = new CountDownLatch(1);
		catalog.source = () -> {
			entered.countDown();
			await(gate);
			return CATALOG;
		};
		clock.advance(Duration.ofSeconds(61));
		ExecutorService executor = Executors.newSingleThreadExecutor();
		try {
			Future<List<PlaceKeywordHit>> refreshing = executor.submit(() -> search.search("쌀국수", 0, 5));
			await(entered);

			// 갱신이 게이트에 막혀 있는데도 이 요청은 바로 돌아온다.
			assertThat(search.search("쌀국수", 0, 5)).isNotEmpty();

			gate.countDown();
			refreshing.get(5, TimeUnit.SECONDS);
			assertThat(catalog.loads).hasValue(2);
		} finally {
			gate.countDown();
			executor.shutdownNow();
		}
	}

	@Test
	@DisplayName("스냅샷_최초읽기중에온요청은_그결과를기다린다")
	void search_firstLoadInProgress_otherRequestWaitsForIt() throws Exception {
		CountDownLatch entered = new CountDownLatch(1);
		CountDownLatch gate = new CountDownLatch(1);
		catalog.source = () -> {
			entered.countDown();
			await(gate);
			return CATALOG;
		};
		RecordingThreads threads = new RecordingThreads();
		ExecutorService executor = Executors.newFixedThreadPool(2, threads);
		try {
			Future<List<PlaceKeywordHit>> first = executor.submit(() -> search.search("쌀국수", 0, 5));
			await(entered);
			Future<List<PlaceKeywordHit>> second = executor.submit(() -> search.search("쌀국수", 0, 5));

			awaitWaitingOnLock(threads.threads.get(1));
			assertThat(second.isDone()).isFalse();

			gate.countDown();
			assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo(first.get(5, TimeUnit.SECONDS));
			assertThat(catalog.loads).hasValue(1);
		} finally {
			gate.countDown();
			executor.shutdownNow();
		}
	}

}
