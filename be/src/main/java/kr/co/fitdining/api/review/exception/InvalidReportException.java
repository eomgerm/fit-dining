package kr.co.fitdining.api.review.exception;

/** "기타"가 아닌 신고 사유에 설명이 있을 때 던진다. {@code ReviewExceptionHandler}가 400으로 바꾼다. */
public class InvalidReportException extends RuntimeException {
}
