package kr.co.fitdining.api.review;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.AuthUser;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.place.PlaceService;
import kr.co.fitdining.api.place.dto.PlaceSummary;
import kr.co.fitdining.api.place.dto.PlaceSummary.CategoryGroup;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewDetailResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewItem;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.dto.ReviewReportRequest;
import kr.co.fitdining.api.review.dto.ReviewUpdateRequest;
import kr.co.fitdining.api.review.dto.TagView;
import kr.co.fitdining.api.review.exception.DuplicateReportException;
import kr.co.fitdining.api.review.exception.DuplicateReviewException;
import kr.co.fitdining.api.review.exception.InvalidVisitDateException;
import kr.co.fitdining.api.review.exception.OwnReviewReportException;
import kr.co.fitdining.api.review.exception.ReviewForbiddenException;
import kr.co.fitdining.api.review.exception.ReviewNotFoundException;
import kr.co.fitdining.api.review.report.ReviewReport;
import kr.co.fitdining.api.review.report.ReviewReportRepository;
import kr.co.fitdining.api.review.store.Review;
import kr.co.fitdining.api.review.store.ReviewCursor;
import kr.co.fitdining.api.review.store.ReviewRepository;
import kr.co.fitdining.api.review.store.ReviewTagRow;
import kr.co.fitdining.api.review.tag.ReasonTag;
import kr.co.fitdining.api.review.tag.ReasonTagRepository;
import kr.co.fitdining.api.review.tag.ReasonTagRule;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 본문 정규화, 작성 시각과 방문일, 중복 금지, 커서 페이지 계산, 작성 화면 데이터, 내 리뷰 수정·삭제, 신고를 맡는다.
 * 등록과 작성 화면 데이터는 장소 기능으로 장소를 확인한다(D-37).
 */
@Service
public class ReviewService {

	static final int PAGE_SIZE = 20;

	/** 같은 사용자·장소·방문일 중복을 막는 부분 유니크 인덱스(V4). 이 제약 위반만 409로 바꾼다(D-28). */
	static final String DUPLICATE_VISIT_CONSTRAINT = "uk_reviews_user_id_place_id_visit_date";

	static final String AUTHOR_CONSTRAINT = "fk_reviews_user_id";

	/** 같은 사람이 같은 리뷰를 두 번 신고하지 못하게 하는 유니크 제약(V8, D-11). */
	static final String DUPLICATE_REPORT_CONSTRAINT = "uk_review_reports_review_id_reporter_id";

	static final String REPORTER_CONSTRAINT = "fk_review_reports_reporter_id";

	private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

	static final int PHOTO_MAX = 5;

	static final ReviewFormResponse.Limits LIMITS = new ReviewFormResponse.Limits(
			ReviewCreateRequest.DESCRIPTION_MAX, PHOTO_MAX, ReviewCreateRequest.SPENT_PER_PERSON_MAX);

	static final ReviewDetailResponse.Limits DETAIL_LIMITS = new ReviewDetailResponse.Limits(
			ReviewCreateRequest.DESCRIPTION_MAX, PHOTO_MAX);

	private final ReviewRepository reviews;
	private final AuthUserRepository users;
	private final PlaceService places;
	private final ReasonTagRepository tags;
	private final ReviewReportRepository reports;
	private final Clock clock;

	public ReviewService(ReviewRepository reviews, AuthUserRepository users, PlaceService places,
			ReasonTagRepository tags, ReviewReportRepository reports, Optional<Clock> clock) {
		this.reviews = reviews;
		this.users = users;
		this.places = places;
		this.tags = tags;
		this.reports = reports;
		this.clock = clock.orElseGet(() -> Clock.system(SEOUL));
	}

	/**
	 * 리뷰를 등록한다. 장소, 방문일, 태그를 이 순서로 확인한 뒤 리뷰와 태그를 함께 저장한다(D-40).
	 *
	 * @param placeId 장소 id
	 * @param userId 작성자 id(인증된 사용자)
	 * @param request 등록 요청. 형식 검증은 컨트롤러가 인증 뒤에 한다.
	 * @return 등록된 리뷰 id
	 * @throws DuplicateReviewException 같은 사용자가 같은 장소에 같은 방문일로 이미 썼을 때
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401). 토큰은 탈퇴 뒤에도 만료 전까지 유효하다(D-38).
	 * @throws kr.co.fitdining.api.place.exception.PlaceNotFoundException 없는 장소일 때
	 * @throws InvalidVisitDateException 방문일이 범위 밖일 때
	 * @throws kr.co.fitdining.api.review.exception.InvalidReasonTagsException 태그가 선택 규칙에 맞지 않을 때
	 */
	public ReviewCreateResponse create(long placeId, String userId, ReviewCreateRequest request) {
		requireActiveUser(userId);
		PlaceSummary place = places.getPlace(placeId).place();
		if (!VisitDatePolicy.at(clock).contains(request.visitedAt())) {
			throw new InvalidVisitDateException();
		}
		ReasonTagRule.validate(request.tagCodes(), tags.findExposed(place.categoryGroup()));
		Review review = new Review(placeId, userId, request.visitedAt(), request.tagCodes(), request.revisitIntent(),
				normalize(request.description()), request.spentPerPerson(), now());
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
				new ReviewFormResponse.Place(place.name(), place.categoryGroup(), place.station(), place.thumbnailUrl(),
						place.lat(), place.lng()),
				new ReviewFormResponse.VisitDate(visitDates.min(), visitDates.max(), visitDates.max()),
				reviews.findReviewedDates(userId, placeId, visitDates.min()),
				new ReviewFormResponse.Tags(good, bad), LIMITS, true);
	}

	/**
	 * 수정 화면(6-07)이 쓰는 내 리뷰 하나(D-44).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws ReviewNotFoundException 없거나 삭제한 리뷰일 때
	 * @throws ReviewForbiddenException 남의 리뷰일 때
	 */
	public ReviewDetailResponse detail(long reviewId, String userId) {
		requireActiveUser(userId);
		Review review = own(reviews.findByReviewIdAndDeletedAtIsNull(reviewId), userId);
		return new ReviewDetailResponse(review.getReviewId(), review.getPlaceId(), review.getDescription(),
				DETAIL_LIMITS);
	}

	/**
	 * 본문을 고친다(D-6, D-44).
	 *
	 * @param request 수정 요청. 형식 검증은 컨트롤러가 인증 뒤에 한다.
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws ReviewNotFoundException 없거나 삭제한 리뷰일 때
	 * @throws ReviewForbiddenException 남의 리뷰일 때
	 */
	@Transactional
	public void update(long reviewId, String userId, ReviewUpdateRequest request) {
		requireActiveUser(userId);
		lockOwn(reviewId, userId).changeDescription(normalize(request.description()), now());
	}

	/**
	 * 리뷰를 지운다. 목록과 리뷰 수에서 바로 빠지고 같은 방문일로 다시 쓸 수 있다(D-28).
	 *
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws ReviewNotFoundException 없거나 이미 삭제한 리뷰일 때
	 * @throws ReviewForbiddenException 남의 리뷰일 때
	 */
	@Transactional
	public void delete(long reviewId, String userId) {
		requireActiveUser(userId);
		lockOwn(reviewId, userId).delete(now());
	}

	/**
	 * 남의 리뷰를 신고한다. 신고만으로 숨기지 않는다(D-11). 저장 전에 신고했는지 따로 보지 않고 유니크 제약으로 막아,
	 * 동시에 두 번 보내도 한 건만 남는다.
	 *
	 * @param request 신고 요청. 형식 검증은 컨트롤러가 인증 뒤에 한다.
	 * @throws AuthFailure 탈퇴했거나 없는 사용자일 때(401)
	 * @throws ReviewNotFoundException 없거나 삭제한 리뷰일 때
	 * @throws OwnReviewReportException 내 리뷰일 때
	 * @throws DuplicateReportException 이미 신고한 리뷰일 때
	 */
	public void report(long reviewId, String reporterId, ReviewReportRequest request) {
		requireActiveUser(reporterId);
		Review review = reviews.findByReviewIdAndDeletedAtIsNull(reviewId).orElseThrow(ReviewNotFoundException::new);
		if (review.getUserId().equals(reporterId)) {
			throw new OwnReviewReportException();
		}
		try {
			reports.saveAndFlush(new ReviewReport(reviewId, reporterId, request.reason(), normalize(request.detail()),
					now()));
		} catch (DataIntegrityViolationException e) {
			if (violates(e, DUPLICATE_REPORT_CONSTRAINT)) {
				throw new DuplicateReportException();
			}
			if (violates(e, REPORTER_CONSTRAINT)) {
				throw new AuthFailure("로그인이 필요합니다.");
			}
			throw e;
		}
	}

	/** 본인 리뷰만 잠가 읽는다. 못 찾았을 때만 한 번 더 읽어 없는 리뷰(404)와 남의 리뷰(403)를 나눈다(D-44). */
	private Review lockOwn(long reviewId, String userId) {
		return reviews.findLockedByReviewIdAndUserIdAndDeletedAtIsNull(reviewId, userId)
				.orElseThrow(() -> reviews.findByReviewIdAndDeletedAtIsNull(reviewId).isPresent()
						? new ReviewForbiddenException()
						: new ReviewNotFoundException());
	}

	private static Review own(Optional<Review> found, String userId) {
		Review review = found.orElseThrow(ReviewNotFoundException::new);
		if (!review.getUserId().equals(userId)) {
			throw new ReviewForbiddenException();
		}
		return review;
	}

	/** PostgreSQL은 마이크로초까지만 저장하므로 커서 비교가 어긋나지 않게 자른다(D-27). */
	private Instant now() {
		return clock.instant().truncatedTo(ChronoUnit.MICROS);
	}

	/** 토큰 검증은 DB를 보지 않아 탈퇴 뒤에도 남은 토큰이 만료 전까지 유효하다(D-38). */
	private void requireActiveUser(String userId) {
		if (!users.existsByIdAndDeletedAtIsNull(userId)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
	}

	/**
	 * 장소의 리뷰를 최신순으로 한 페이지 돌려준다. 리뷰 수는 첫 페이지에서만 센다. 작성자와 태그는 페이지 단위로
	 * 한 번씩 읽어 페이지 하나가 쿼리 4번(목록, 리뷰 수, 작성자, 태그)이다(D-42).
	 *
	 * @param placeId 장소 id
	 * @param cursor 다음 페이지 요청일 때 직전 응답의 {@code nextCursor}
	 * @param viewerId 조회한 사용자 id. 로그인 없이 조회하면 null이다.
	 * @return 리뷰 목록
	 * @throws kr.co.fitdining.api.place.exception.PlaceNotFoundException 없는 장소일 때
	 */
	public ReviewListResponse list(long placeId, String cursor, String viewerId) {
		ReviewCursor after = cursor == null || cursor.isEmpty() ? null : ReviewCursor.decode(cursor);
		CategoryGroup category = places.getPlace(placeId).place().categoryGroup();
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
		return new ReviewListResponse(totalCount, items(page, category, viewerId), nextCursor);
	}

	private List<ReviewItem> items(List<Review> page, CategoryGroup category, String viewerId) {
		if (page.isEmpty()) {
			return List.of();
		}
		Map<String, String> nicknames = new HashMap<>();
		for (AuthUser user : users.findAllById(page.stream().map(Review::getUserId).distinct().toList())) {
			if (user.getDeletedAt() == null) {
				nicknames.put(user.getId(), user.getNickname());
			}
		}
		Map<Long, List<TagView>> tagsByReview = new HashMap<>();
		for (ReviewTagRow row : reviews.findTags(page.stream().map(Review::getReviewId).toList(), category.name())) {
			tagsByReview.computeIfAbsent(row.getReviewId(), id -> new ArrayList<>()).add(new TagView(row.getCode(),
					row.getLabel(), ReasonTag.Sentiment.valueOf(row.getSentiment())));
		}
		return page.stream().map(review -> new ReviewItem(review.getReviewId(),
				review.getCreatedAt().atZone(SEOUL).toOffsetDateTime(), review.getVisitDate(),
				nicknames.get(review.getUserId()), review.isRevisitIntent(),
				tagsByReview.getOrDefault(review.getReviewId(), List.of()), review.getDescription(),
				review.getUserId().equals(viewerId))).toList();
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

}
