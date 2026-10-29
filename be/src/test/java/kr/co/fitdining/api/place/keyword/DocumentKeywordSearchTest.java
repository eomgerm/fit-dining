package kr.co.fitdining.api.place.keyword;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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
	@DisplayName("스냅샷_갱신에실패하면_마지막스냅샷으로응답하고계속다시시도한다")
	void search_refreshFails_keepsServingLastSnapshot() {
		List<PlaceKeywordHit> before = search.search("쌀국수", 0, 5);
		catalog.source = () -> {
			throw new IllegalStateException("db down");
		};
		clock.advance(Duration.ofSeconds(61));

		assertThat(search.search("쌀국수", 0, 5)).isEqualTo(before);
		assertThat(search.search("쌀국수", 0, 5)).isEqualTo(before);
		assertThat(catalog.loads).hasValue(3);
	}

	@Test
	@DisplayName("스냅샷_한번도읽지못했으면_503예외이고다음요청이다시읽는다")
	void search_neverLoaded_throwsUnavailableThenRecovers() {
		catalog.source = () -> {
			throw new IllegalStateException("db down");
		};

		assertThatThrownBy(() -> search.search("쌀국수", 0, 5)).isInstanceOf(PlaceSearchUnavailableException.class);

		catalog.source = () -> CATALOG;
		assertThat(search.search("쌀국수", 0, 5)).isNotEmpty();
		assertThat(catalog.loads).hasValue(2);
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
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			Future<List<PlaceKeywordHit>> first = executor.submit(() -> search.search("쌀국수", 0, 5));
			await(entered);
			Future<List<PlaceKeywordHit>> second = executor.submit(() -> search.search("쌀국수", 0, 5));

			Thread.sleep(200);
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
