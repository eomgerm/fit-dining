package kr.co.fitdining.api.review.store;

import java.util.List;

/**
 * 리뷰 저장소의 교체 지점(D-27). Walking Skeleton은 메모리 구현을 꽂고, 1차 후속은 {@code reviews} 테이블을
 * 쓰는 구현으로 바꾼다. 저장소 밖(서비스, DTO, 커서 형식)은 구현이 바뀌어도 그대로다.
 *
 * <p>정렬은 작성 시각 내림차순, 같으면 리뷰 id 내림차순이다({@link ReviewCursor#NEWEST_FIRST}). 커서 문자열의
 * 인코딩과 다음 페이지 판단은 {@code ReviewService}가 맡아 구현마다 결과가 달라지지 않게 한다.
 */
public interface ReviewStore {

	/**
	 * 리뷰를 저장하고 id를 매긴다.
	 *
	 * @param newReview 저장할 리뷰. 본문 정규화와 작성 시각은 서비스가 끝낸 값이다.
	 * @return 저장된 리뷰
	 */
	StoredReview save(NewReview newReview);

	/**
	 * 장소의 리뷰를 최신순으로 돌려준다.
	 *
	 * @param placeId 장소 id
	 * @param after 이 위치의 다음 리뷰부터 돌려준다. 첫 페이지면 null이다.
	 * @param limit 최대 개수
	 * @return 최신순 리뷰. 없으면 빈 목록이다.
	 */
	List<StoredReview> findPage(long placeId, ReviewCursor after, int limit);

	/**
	 * 장소의 리뷰 수를 돌려준다.
	 *
	 * @param placeId 장소 id
	 * @return 리뷰 수
	 */
	int count(long placeId);

}
