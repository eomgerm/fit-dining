package kr.co.fitdining.api.review.store;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

class InMemoryReviewStoreTest {

	private static final Instant BASE = Instant.parse("2026-10-21T03:00:00Z");

	private static NewReview review(long placeId, long secondsAfterBase) {
		return new NewReview(placeId, "본문", BASE.plusSeconds(secondsAfterBase));
	}

	private static List<Long> ids(List<StoredReview> reviews) {
		return reviews.stream().map(StoredReview::reviewId).toList();
	}

	@Nested
	@DisplayName("저장")
	class Save {

		@Test
		@DisplayName("저장_시드다음부터_id를차례로매긴다")
		void save_afterSeed_assignsNextIds() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(review(1, 0), review(1, 1)));

			StoredReview saved = store.save(review(1, 2));

			assertThat(saved.reviewId()).isEqualTo(3);
			assertThat(saved.placeId()).isEqualTo(1);
			assertThat(saved.description()).isEqualTo("본문");
			assertThat(saved.createdAt()).isEqualTo(BASE.plusSeconds(2));
		}

		@Test
		@DisplayName("저장_상한을넘으면_가장오래된리뷰를버린다")
		void save_overCapacity_dropsOldest() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of());
			for (int i = 0; i < InMemoryReviewStore.CAPACITY; i++) {
				store.save(review(1, i));
			}

			store.save(review(1, InMemoryReviewStore.CAPACITY));

			assertThat(store.count(1)).isEqualTo(InMemoryReviewStore.CAPACITY);
			List<StoredReview> all = store.findPage(1, null, InMemoryReviewStore.CAPACITY);
			assertThat(ids(all)).doesNotContain(1L).contains(2L, (long) InMemoryReviewStore.CAPACITY + 1);
		}
	}

	@Nested
	@DisplayName("목록")
	class FindPage {

		@Test
		@DisplayName("목록_작성시각내림차순이고_같은시각이면id내림차순이다")
		void findPage_mixedCreatedAt_newestFirstThenHigherId() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(
					review(1, 10), review(1, 20), review(1, 20), review(1, 5)));

			assertThat(ids(store.findPage(1, null, 10))).containsExactly(3L, 2L, 1L, 4L);
		}

		@Test
		@DisplayName("목록_다른장소의리뷰는_빠진다")
		void findPage_otherPlaces_excluded() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(review(1, 0), review(2, 1), review(1, 2)));

			assertThat(ids(store.findPage(1, null, 10))).containsExactly(3L, 1L);
			assertThat(store.findPage(3, null, 10)).isEmpty();
		}

		@Test
		@DisplayName("목록_커서가있으면_그위치다음부터준다")
		void findPage_withCursor_returnsAfterPosition() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(
					review(1, 0), review(1, 1), review(1, 1), review(1, 2)));
			StoredReview third = store.findPage(1, null, 3).getLast();

			List<StoredReview> rest = store.findPage(1, ReviewCursor.of(third), 10);

			assertThat(third.reviewId()).isEqualTo(2);
			assertThat(ids(rest)).containsExactly(1L);
		}

		@Test
		@DisplayName("목록_limit보다많으면_limit만큼준다")
		void findPage_moreThanLimit_returnsLimit() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(review(1, 0), review(1, 1), review(1, 2)));

			assertThat(ids(store.findPage(1, null, 2))).containsExactly(3L, 2L);
		}

		@Test
		@DisplayName("개수_장소별로_센다")
		void count_perPlace_countsOnlyThatPlace() {
			InMemoryReviewStore store = new InMemoryReviewStore(List.of(review(1, 0), review(2, 1), review(1, 2)));

			assertThat(store.count(1)).isEqualTo(2);
			assertThat(store.count(2)).isEqualTo(1);
			assertThat(store.count(3)).isZero();
		}
	}

}
