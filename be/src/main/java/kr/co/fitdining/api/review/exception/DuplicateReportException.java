package kr.co.fitdining.api.review.exception;

/** 같은 리뷰를 이미 신고했을 때 던진다. {@code ReviewExceptionHandler}가 409로 바꾼다. */
public class DuplicateReportException extends RuntimeException {
}
