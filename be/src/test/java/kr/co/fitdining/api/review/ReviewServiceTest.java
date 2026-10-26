package kr.co.fitdining.api.review;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.store.ReviewRepository;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.DataIntegrityViolationException;

/** DB 없이 확인할 수 있는 규칙. 저장과 목록은 {@code ReviewPersistenceTest}가 실제 PostgreSQL로 확인한다. */
class ReviewServiceTest {

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
	@DisplayName("작성자 확인")
	class Author {

		private final ReviewRepository reviews = mock(ReviewRepository.class);
		private final AuthUserRepository users = mock(AuthUserRepository.class);
		private final ReviewService service = new ReviewService(reviews, users,
				Optional.of(Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneOffset.UTC)));

		@Test
		@DisplayName("등록_저장중작성자FK위반이면_401이다")
		void create_authorForeignKeyViolation_unauthorized() {
			when(users.existsByIdAndDeletedAtIsNull("user-1")).thenReturn(true);
			when(reviews.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("x",
					new ConstraintViolationException("fk", new SQLException(), ReviewService.AUTHOR_CONSTRAINT)));

			assertThatThrownBy(() -> service.create(1, "user-1", new ReviewCreateRequest(null)))
					.isInstanceOfSatisfying(AuthFailure.class, failure -> assertThat(failure.status()).isEqualTo(401));
		}
	}

	@Nested
	@DisplayName("제약 위반 판별")
	class Violates {

		private static DataIntegrityViolationException violation(String constraint) {
			return new DataIntegrityViolationException("could not execute statement",
					new ConstraintViolationException("duplicate key", new SQLException(), constraint));
		}

		@Test
		@DisplayName("제약위반_같은방문일인덱스면_참이다")
		void violates_duplicateVisitIndex_true() {
			assertThat(ReviewService.violates(violation(ReviewService.DUPLICATE_VISIT_CONSTRAINT),
					ReviewService.DUPLICATE_VISIT_CONSTRAINT)).isTrue();
		}

		@Test
		@DisplayName("제약위반_다른제약이면_거짓이다")
		void violates_otherConstraint_false() {
			assertThat(ReviewService.violates(violation("fk_reviews_user_id"),
					ReviewService.DUPLICATE_VISIT_CONSTRAINT)).isFalse();
		}

		@Test
		@DisplayName("제약위반_제약이름을알수없으면_거짓이다")
		void violates_noConstraintName_false() {
			assertThat(ReviewService.violates(new DataIntegrityViolationException("unknown"),
					ReviewService.DUPLICATE_VISIT_CONSTRAINT)).isFalse();
		}
	}

}
