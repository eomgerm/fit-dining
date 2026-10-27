package kr.co.fitdining.api.review;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.store.Review;
import kr.co.fitdining.api.review.store.ReviewCursor;
import kr.co.fitdining.api.review.store.ReviewRepository;
import kr.co.fitdining.api.review.tag.ReasonTag;
import kr.co.fitdining.api.review.tag.ReasonTagRepository;
import kr.co.fitdining.api.review.tag.ReasonTagRule;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * 본문 정규화, 작성 시각과 방문일, 중복 금지, 커서 페이지 계산, 작성 화면 데이터를 맡는다. 등록과 작성 화면 데이터는
 * 장소 기능으로 장소를 확인한다(D-37).
 */
@Service
public class ReviewService {

	static final int PAGE_SIZE = 20;

	/** 같은 사용자·장소·방문일 중복을 막는 부분 유니크 인덱스(V4). 이 제약 위반만 409로 바꾼다(D-28). */
	static final String DUPLICATE_VISIT_CONSTRAINT = "uk_reviews_user_id_place_id_visit_date";

	static final String AUTHOR_CONSTRAINT = "fk_reviews_user_id";

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	static final ReviewFormResponse.Limits LIMITS = new ReviewFormResponse.Limits(500, 5, 1_000_000);

	private final ReviewRepository reviews;
	private final AuthUserRepository users;
	private final PlaceService places;
	private final ReasonTagRepository tags;
	private final Clock clock;

	public ReviewService(ReviewRepository reviews, AuthUserRepository users, PlaceService places,
			ReasonTagRepository tags, Optional<Clock> clock) {
		this.reviews = reviews;
		this.users = users;
		this.places = places;
		this.tags = tags;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	/**
	 * 리뷰를 등록한다. 방문일은 아직 입력받지 않아 KST 오늘이다.
	 *
	 * @param placeId 장소 id
	 * @param userId 작성자 id(인증된 사용자)
	 * @param request 등록 요청
	 * @return 등록된 리뷰 id
	 * @throws DuplicateReviewException 같은 사용자가 같은 장소에 같은 방문일로 이미 썼을 때
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401). 토큰은 탈퇴 뒤에도 만료 전까지 유효하다(D-38).
	 * @throws kr.co.fitdining.api.place.exception.PlaceNotFoundException 없는 장소일 때
	 */
	public ReviewCreateResponse create(long placeId, String userId, ReviewCreateRequest request) {
		requireActiveUser(userId);
		places.getPlace(placeId);
		// PostgreSQL은 마이크로초까지만 저장하므로 커서 비교가 어긋나지 않게 자른다(D-27).
		Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
		Review review = new Review(placeId, userId, LocalDate.ofInstant(now, SEOUL),
				normalize(request.description()), now);
		try {
			// 저장 전 조회는 동시 요청을 막지 못한다. 제약 위반을 그 자리에서 받으려고 flush한다(D-28).
			return new ReviewCreateResponse(reviews.saveAndFlush(review).getReviewId());
		} catch (DataIntegrityViolationException e) {
			if (violates(e, DUPLICATE_VISIT_CONSTRAINT)) {
				throw new DuplicateReviewException();
			}
			if (violates(e, AUTHOR_CONSTRAINT)) {
				throw new AuthFailure("로그인이 필요합니다.");
			}
			throw e;
		}
	}

	/**
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws kr.co.fitdining.api.place.exception.PlaceNotFoundException 없는 장소일 때
	 */
	public ReviewFormResponse reviewForm(long placeId, String userId) {
		requireActiveUser(userId);
		PlaceSummary place = places.getPlace(placeId).place();
		VisitDatePolicy visitDates = VisitDatePolicy.at(clock);
		List<ReviewFormResponse.FormTag> good = new ArrayList<>();
		List<ReviewFormResponse.FormTag> bad = new ArrayList<>();
		for (ReasonTag tag : tags.findExposed(place.categoryGroup())) {
			(tag.sentiment() == ReasonTag.Sentiment.GOOD ? good : bad).add(new ReviewFormResponse.FormTag(
					tag.code(), tag.label(), ReasonTagRule.group(tag), tag.displayGroup()));
		}
		return new ReviewFormResponse(
				new ReviewFormResponse.Place(place.name(), place.categoryGroup(), place.station()),
				new ReviewFormResponse.VisitDate(visitDates.min(), visitDates.max(), visitDates.max()),
				reviews.findReviewedDates(userId, placeId, visitDates.min()),
				new ReviewFormResponse.Tags(good, bad), LIMITS, true);
	}

	/** 토큰 검증은 DB를 보지 않아 탈퇴 뒤에도 남은 토큰이 만료 전까지 유효하다(D-38). */
	private void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	/**
	 * 장소의 리뷰를 최신순으로 한 페이지 돌려준다. 리뷰 수는 첫 페이지에서만 센다.
	 *
	 * @param placeId 장소 id
	 * @param cursor 다음 페이지 요청일 때 직전 응답의 {@code nextCursor}
	 * @return 리뷰 목록
	 */
	public ReviewListResponse list(long placeId, String cursor) {
		ReviewCursor after = cursor == null || cursor.isEmpty() ? null : ReviewCursor.decode(cursor);
		// 한 건을 더 읽어 다음 페이지가 있는지 판단한다.
		List<Review> rows = after == null
				? reviews.findFirstPage(placeId, PAGE_SIZE + 1)
				: reviews.findPageAfter(placeId, after.createdAt(), after.reviewId(), PAGE_SIZE + 1);
		boolean hasNext = rows.size() > PAGE_SIZE;
		List<Review> page = hasNext ? rows.subList(0, PAGE_SIZE) : rows;
		String nextCursor = hasNext ? ReviewCursor.of(page.getLast()).encode() : null;
		Integer totalCount = after == null
				? Math.toIntExact(reviews.countByPlaceIdAndDeletedAtIsNull(placeId))
				: null;
		return new ReviewListResponse(totalCount, page.stream().map(ReviewService::toItem).toList(), nextCursor);
	}

	/** 공백뿐인 본문은 본문 없음(null)이다(D-6). 길이 검증은 원문 기준이라 그 밖에는 그대로 둔다. */
	static String normalize(String description) {
		return description == null || description.isBlank() ? null : description;
	}

	/** 원인 예외 중 Hibernate가 제약 이름을 꺼낸 것이 있으면 그 이름을 비교한다. */
	static boolean violates(Throwable e, String constraint) {
		for (Throwable cause = e; cause != null; cause = cause.getCause()) {
			if (cause instanceof ConstraintViolationException violation) {
				return constraint.equalsIgnoreCase(violation.getConstraintName());
			}
		}
		return false;
	}

	private static ReviewItem toItem(Review review) {
		return new ReviewItem(review.getReviewId(), review.getCreatedAt().atZone(SEOUL).toOffsetDateTime(),
				review.getDescription());
	}

}
