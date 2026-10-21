package kr.co.fitdining.api.review.store;

/** 해석할 수 없는 cursor를 받았을 때 던진다. {@code ReviewExceptionHandler}가 400으로 바꾼다. */
public class InvalidReviewCursorException extends RuntimeException {
}
