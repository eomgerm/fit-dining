package kr.co.fitdining.api.review.exception;

/** 없거나 삭제한 리뷰를 찾을 때 던진다. {@code ReviewExceptionHandler}가 404로 바꾼다. */
public class ReviewNotFoundException extends RuntimeException {
}
