package kr.co.fitdining.api.review.store;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import java.util.Comparator;

/**
 * 목록의 위치. 작성 시각 내림차순, 같으면 리뷰 id 내림차순 정렬에서 리뷰 하나를 가리킨다.
 *
 * <p>문자열 형식은 {@code <ISO-8601 작성 시각>|<리뷰 id>}를 패딩 없는 base64url로 인코딩한 값이다(검색 Mock과
 * 같은 방식). 저장소 구현과 관계없이 같아서 1차 후속에 DB로 바꿔도 FE가 가진 커서가 그대로 쓰인다(D-27).
 *
 * @param createdAt 작성 시각
 * @param reviewId 리뷰 id
 */
public record ReviewCursor(
		Instant createdAt,
		long reviewId
) {

	/** 최신순. 작성 시각 내림차순, 같으면 리뷰 id 내림차순이다. */
	public static final Comparator<ReviewCursor> NEWEST_FIRST = Comparator.comparing(ReviewCursor::createdAt)
			.thenComparingLong(ReviewCursor::reviewId)
			.reversed();

	private static final char SEPARATOR = '|';

	public static ReviewCursor of(StoredReview review) {
		return new ReviewCursor(review.createdAt(), review.reviewId());
	}

	public String encode() {
		String plain = createdAt + String.valueOf(SEPARATOR) + reviewId;
		return Base64.getUrlEncoder().withoutPadding().encodeToString(plain.getBytes(StandardCharsets.UTF_8));
	}

	/**
	 * 커서 문자열을 해석한다.
	 *
	 * @param cursor 직전 응답의 {@code nextCursor}
	 * @return 해석한 위치
	 * @throws InvalidReviewCursorException 패딩이 있거나, base64url이 아니거나, 내용이 형식에 맞지 않을 때
	 */
	public static ReviewCursor decode(String cursor) {
		if (cursor.contains("=")) {
			throw new InvalidReviewCursorException();
		}
		String plain;
		try {
			plain = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
		} catch (IllegalArgumentException e) {
			throw new InvalidReviewCursorException();
		}
		int separatorAt = plain.lastIndexOf(SEPARATOR);
		if (separatorAt < 0) {
			throw new InvalidReviewCursorException();
		}
		try {
			return new ReviewCursor(Instant.parse(plain.substring(0, separatorAt)),
					Long.parseLong(plain.substring(separatorAt + 1)));
		} catch (DateTimeParseException | NumberFormatException e) {
			throw new InvalidReviewCursorException();
		}
	}

}
