package kr.co.fitdining.api.review.exception;

import kr.co.fitdining.api.review.ReviewController;
import kr.co.fitdining.api.review.store.InvalidReviewCursorException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 리뷰 API의 오류를 ProblemDetail로 바꾼다(D-20). 예외 메시지에는 요청 본문(리뷰 본문)이 들어 있을 수 있어
 * detail에 넣지도, 로그에 남기지도 않는다.
 */
@Slf4j
@RestControllerAdvice(basePackageClasses = ReviewController.class)
public class ReviewExceptionHandler {

	@ExceptionHandler({
			MethodArgumentNotValidException.class,
			HandlerMethodValidationException.class,
			HttpMessageNotReadableException.class,
			MethodArgumentTypeMismatchException.class,
			InvalidReviewCursorException.class
	})
	public ProblemDetail handleBadRequest(Exception e) {
		log.info("Rejected review request: reason={}", e.getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않아요.");
	}

	@ExceptionHandler(ReviewUnavailableException.class)
	public ProblemDetail handleUnavailable() {
		log.warn("Review store is not configured");
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 리뷰를 쓸 수 없어요.");
	}

}
