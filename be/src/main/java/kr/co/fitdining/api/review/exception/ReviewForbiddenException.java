package kr.co.fitdining.api.review.exception;

/** 남의 리뷰를 조회·수정·삭제하려 할 때 던진다. {@code ReviewExceptionHandler}가 403으로 바꾼다. */
public class ReviewForbiddenException extends RuntimeException {
}
