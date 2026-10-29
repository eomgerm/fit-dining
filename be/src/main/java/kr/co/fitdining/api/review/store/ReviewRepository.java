package kr.co.fitdining.api.review.store;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 리뷰 저장과 장소별 목록 조회. 목록은 {@code idx_reviews_place_id_created_at_review_id}를 타도록
 * 조건과 정렬을 인덱스 순서에 맞추고, 커서는 행 비교로 범위를 좁힌다.
 */
public interface ReviewRepository extends JpaRepository<Review, Long> {

	/** 장소별 첫 페이지. 삭제한 리뷰를 뺀 최신순이다. */
	String FIRST_PAGE = """
			SELECT * FROM reviews
			WHERE place_id = :placeId AND deleted_at IS NULL
			ORDER BY created_at DESC, review_id DESC
			LIMIT :limit""";

	/** 장소별 다음 페이지. 직전 페이지 마지막 리뷰보다 오래된 것만 읽는다. */
	String PAGE_AFTER = """
			SELECT * FROM reviews
			WHERE place_id = :placeId AND deleted_at IS NULL
			  AND (created_at, review_id) < (:createdAt, :reviewId)
			ORDER BY created_at DESC, review_id DESC
			LIMIT :limit""";

	/** 목록 페이지 리뷰들의 태그. 문구는 장소 업종의 것을 쓰고, 좋았어요를 먼저 두고 그 안에서는 시드의 순서를 따른다. */
	String REVIEW_TAGS = """
			SELECT rt.review_id AS "reviewId", t.code AS "code", t.sentiment AS "sentiment",
			       COALESCE(c.label, t.label) AS "label"
			FROM review_reason_tags rt
			JOIN reason_tags t ON t.code = rt.code
			LEFT JOIN reason_tag_categories c ON c.category = :category AND c.code = rt.code
			WHERE rt.review_id IN (:reviewIds)
			ORDER BY rt.review_id, t.sentiment = 'BAD', t.sort_order""";

	/** 목록 페이지 리뷰들의 사진. 리뷰마다 화면 순서대로다. */
	String REVIEW_PHOTOS = """
			SELECT review_id AS "reviewId", photo_id AS "photoId" FROM review_photos
			WHERE review_id IN (:reviewIds)
			ORDER BY review_id, sort_order""";

	String REVIEWED_DATES = """
			SELECT visit_date FROM reviews
			WHERE user_id = :userId AND place_id = :placeId AND deleted_at IS NULL AND visit_date >= :from
			ORDER BY visit_date""";

	/**
	 * @param placeId 장소 id
	 * @param limit 읽을 최대 건수
	 * @return 최신순 리뷰
	 */
	@Query(value = FIRST_PAGE, nativeQuery = true)
	List<Review> findFirstPage(@Param("placeId") long placeId, @Param("limit") int limit);

	/**
	 * @param placeId 장소 id
	 * @param createdAt 직전 페이지 마지막 리뷰의 작성 시각
	 * @param reviewId 직전 페이지 마지막 리뷰의 id
	 * @param limit 읽을 최대 건수
	 * @return 최신순 리뷰
	 */
	@Query(value = PAGE_AFTER, nativeQuery = true)
	List<Review> findPageAfter(@Param("placeId") long placeId, @Param("createdAt") Instant createdAt,
			@Param("reviewId") long reviewId, @Param("limit") int limit);

	/**
	 * @param placeId 장소 id
	 * @return 삭제한 리뷰를 뺀 리뷰 수
	 */
	long countByPlaceIdAndDeletedAtIsNull(long placeId);

	/**
	 * @param reviewIds 목록 페이지의 리뷰 id
	 * @param category 장소 업종({@code RESTAURANT}, {@code CAFE}, {@code BAR})
	 * @return 리뷰별 태그. 페이지 크기와 상관없이 한 번에 읽는다.
	 */
	@Query(value = REVIEW_TAGS, nativeQuery = true)
	List<ReviewTagRow> findTags(@Param("reviewIds") Collection<Long> reviewIds, @Param("category") String category);

	/**
	 * @param reviewIds 목록 페이지의 리뷰 id
	 * @return 리뷰별 사진. 페이지 크기와 상관없이 한 번에 읽는다.
	 */
	@Query(value = REVIEW_PHOTOS, nativeQuery = true)
	List<ReviewPhotoRow> findPhotos(@Param("reviewIds") Collection<Long> reviewIds);

	@Query(value = REVIEWED_DATES, nativeQuery = true)
	List<LocalDate> findReviewedDates(@Param("userId") String userId, @Param("placeId") long placeId,
			@Param("from") LocalDate from);

	Optional<Review> findByReviewIdAndDeletedAtIsNull(long reviewId);

	/**
	 * 수정과 삭제가 읽는 내 리뷰. 행을 잠가, 먼저 끝난 삭제 뒤의 수정은 리뷰를 찾지 못한다(D-44).
	 * 잠그지 않으면 삭제 전에 읽은 수정이 {@code deleted_at}을 되돌려 쓴다. 작성자가 다른 행은 조건에 맞지 않아
	 * 잠그지도 기다리지도 않는다.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	Optional<Review> findLockedByReviewIdAndUserIdAndDeletedAtIsNull(long reviewId, String userId);

}
