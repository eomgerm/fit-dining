package kr.co.fitdining.api.review.store;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
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

}
