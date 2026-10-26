package kr.co.fitdining.api.review.exception;

/** 같은 사용자가 같은 장소에 같은 방문일로 이미 리뷰를 썼을 때 던진다. {@code ReviewExceptionHandler}가 409로 바꾼다. */
public class DuplicateReviewException extends RuntimeException {
}
