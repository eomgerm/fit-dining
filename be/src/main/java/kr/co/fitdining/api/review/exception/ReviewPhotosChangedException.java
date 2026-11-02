package kr.co.fitdining.api.review.exception;

/** 사진을 확정하는 사이 리뷰의 사진 목록이 바뀌었을 때 던진다(D-51). {@code ReviewExceptionHandler}가 409로 바꾼다. */
public class ReviewPhotosChangedException extends RuntimeException {
}
