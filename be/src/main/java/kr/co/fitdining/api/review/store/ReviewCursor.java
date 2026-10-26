package kr.co.fitdining.api.review.store;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Base64;

/**
 * 목록의 위치. 작성 시각 내림차순, 같으면 리뷰 id 내림차순 정렬에서 리뷰 하나를 가리킨다.
 *
 * <p>문자열 형식은 {@code <ISO-8601 작성 시각>|<리뷰 id>}를 패딩 없는 base64url로 인코딩한 값이다(검색 Mock과
 * 같은 방식). 메모리 저장소 때와 같은 형식이라 DB로 바꾼 뒤에도 FE가 가진 커서가 그대로 쓰인다(D-35).
 *
 * @param createdAt 작성 시각
 * @param reviewId 리뷰 id
 */
public record ReviewCursor(
		Instant createdAt,
		long reviewId
) {

	private static final char SEPARATOR = '|';

	public static ReviewCursor of(Review review) {
		return new ReviewCursor(review.getCreatedAt(), review.getReviewId());
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
