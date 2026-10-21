package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.exception.ReviewUnavailableException;
import kr.co.fitdining.api.review.store.InMemoryReviewStore;
import kr.co.fitdining.api.review.store.ReviewStore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.support.StaticListableBeanFactory;

/** 실제 메모리 저장소와 고정 시계로 본문 정규화, 작성 시각, 커서 페이지를 확인한다. */
class ReviewServiceTest {

	/** 2026-10-21 12:00:00.123456789 KST. 나노초가 있어 마이크로초 절사를 확인할 수 있다. */
	private static final Instant NOW = Instant.parse("2026-10-21T03:00:00.123456789Z");

	private final InMemoryReviewStore store = new InMemoryReviewStore(List.of());
	private final ReviewService service = new ReviewService(provider(store),
			Optional.of(Clock.fixed(NOW, ZoneId.of("UTC"))));

	private static ObjectProvider<ReviewStore> provider(ReviewStore store) {
		Map<String, Object> beans = store == null ? Map.of() : Map.of("reviewStore", store);
		return new StaticListableBeanFactory(beans).getBeanProvider(ReviewStore.class);
	}

	@Nested
	@DisplayName("본문 정규화")
	class Normalize {

		@ParameterizedTest
		@NullSource
		@ValueSource(strings = {"", " ", "\n\t "})
		@DisplayName("본문_없거나공백뿐이면_null이다")
		void normalize_nullOrBlank_returnsNull(String description) {
			assertThat(ReviewService.normalize(description)).isNull();
		}

		@Test
		@DisplayName("본문_내용이있으면_앞뒤공백까지그대로둔다")
		void normalize_withContent_keepsOriginal() {
			assertThat(ReviewService.normalize("  좋았어요 \n")).isEqualTo("  좋았어요 \n");
		}
	}

	@Nested
	@DisplayName("등록")
	class Create {

		@Test
		@DisplayName("등록_작성시각은_마이크로초로자르고KST오프셋으로보인다")
		void create_now_truncatedToMicrosAndShownInSeoul() {
			service.create(1, new ReviewCreateRequest("좋았어요"));

			ReviewItem item = service.list(1, null).items().getFirst();
			assertThat(item.createdAt().toInstant()).isEqualTo(Instant.parse("2026-10-21T03:00:00.123456Z"));
			assertThat(item.createdAt().getOffset().getId()).isEqualTo("+09:00");
		}

		@Test
		@DisplayName("등록_공백뿐인본문이면_본문없이저장한다")
		void create_blankDescription_storedWithoutDescription() {
			service.create(1, new ReviewCreateRequest("   "));

			assertThat(service.list(1, null).items().getFirst().description()).isNull();
		}

		@Test
		@DisplayName("등록_저장소가없으면_예외다")
		void create_noStore_throws() {
			ReviewService noStore = new ReviewService(provider(null), Optional.empty());

			assertThatThrownBy(() -> noStore.create(1, new ReviewCreateRequest(null)))
					.isInstanceOf(ReviewUnavailableException.class);
		}
	}

	@Nested
	@DisplayName("목록")
	class ListReviews {

		@Test
		@DisplayName("목록_같은시각의리뷰가45건이면_20건20건5건으로중복없이나뉜다")
		void list_45ReviewsSameCreatedAt_pagesWithoutOverlap() {
			for (int i = 0; i < 45; i++) {
				service.create(1, new ReviewCreateRequest("리뷰 " + i));
			}

			ReviewListResponse first = service.list(1, null);
			ReviewListResponse second = service.list(1, first.nextCursor());
			ReviewListResponse third = service.list(1, second.nextCursor());

			assertThat(first.totalCount()).isEqualTo(45);
			assertThat(first.items()).hasSize(20);
			assertThat(second.items()).hasSize(20);
			assertThat(third.items()).hasSize(5);
			assertThat(third.nextCursor()).isNull();
			List<Long> ids = new ArrayList<>();
			for (ReviewListResponse page : List.of(first, second, third)) {
				page.items().forEach(item -> ids.add(item.reviewId()));
			}
			assertThat(ids).doesNotHaveDuplicates().hasSize(45).isSortedAccordingTo((a, b) -> Long.compare(b, a));
		}

		@Test
		@DisplayName("목록_정확히20건이면_다음커서가없다")
		void list_exactly20_noNextCursor() {
			for (int i = 0; i < 20; i++) {
				service.create(1, new ReviewCreateRequest(null));
			}

			ReviewListResponse page = service.list(1, null);

			assertThat(page.items()).hasSize(20);
			assertThat(page.nextCursor()).isNull();
		}

		@Test
		@DisplayName("목록_리뷰가없으면_빈목록과0이다")
		void list_noReviews_emptyAndZero() {
			ReviewListResponse page = service.list(1, null);

			assertThat(page.totalCount()).isZero();
			assertThat(page.items()).isEmpty();
			assertThat(page.nextCursor()).isNull();
		}

		@Test
		@DisplayName("목록_빈커서는_첫페이지다")
		void list_emptyCursor_firstPage() {
			service.create(1, new ReviewCreateRequest("좋았어요"));

			assertThat(service.list(1, "").items()).hasSize(1);
		}
	}

}
