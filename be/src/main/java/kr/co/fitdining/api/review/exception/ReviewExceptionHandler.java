package kr.co.fitdining.api.review.exception;

import jakarta.validation.ConstraintViolationException;
import java.net.URI;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import kr.co.fitdining.api.review.ReviewController;
import kr.co.fitdining.api.review.photo.InvalidPhotoException;
import kr.co.fitdining.api.review.photo.PhotoStorageUnavailableException;
import kr.co.fitdining.api.review.store.InvalidReviewCursorException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
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

	static final URI INVALID_PHOTO_TYPE = URI.create("urn:fitdining:review:invalid-photo");

	@ExceptionHandler({
			MethodArgumentNotValidException.class,
			HandlerMethodValidationException.class,
			HttpMessageNotReadableException.class,
			MethodArgumentTypeMismatchException.class,
			ConstraintViolationException.class,
			InvalidReviewCursorException.class,
			InvalidVisitDateException.class,
			InvalidReasonTagsException.class,
			InvalidReportException.class
	})
	public ProblemDetail handleBadRequest(Exception e) {
		log.info("Rejected review request: reason={}", e.getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않아요.");
	}

	/**
	 * 인증 모듈의 처리기는 인증 API에만 걸려 있어 리뷰가 직접 바꾼다. FE가 토큰 만료를 알아보고 갱신하도록
	 * 상태 코드와 {@code type}을 그대로 둔다.
	 */
	@ExceptionHandler(AuthFailure.class)
	public ProblemDetail handleAuthFailure(AuthFailure failure) {
		log.info("Rejected review request: reason=AuthFailure, status={}", failure.status());
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(failure.status()),
				"로그인이 필요해요.");
		if (failure.type() != null) {
			problem.setType(failure.type());
		}
		return problem;
	}

	@ExceptionHandler(PlaceNotFoundException.class)
	public ProblemDetail handlePlaceNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "장소를 찾을 수 없어요.");
	}

	@ExceptionHandler(PlaceSearchUnavailableException.class)
	public ProblemDetail handlePlaceUnavailable() {
		log.warn("Place lookup is unavailable for review");
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 리뷰를 쓸 수 없어요.");
	}

	@ExceptionHandler(DuplicateReviewException.class)
	public ProblemDetail handleDuplicate() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "이 날짜에는 이미 리뷰를 남겼어요.");
	}

	@ExceptionHandler(ReviewNotFoundException.class)
	public ProblemDetail handleReviewNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "리뷰를 찾을 수 없어요.");
	}

	@ExceptionHandler(ReviewForbiddenException.class)
	public ProblemDetail handleForbidden() {
		log.info("Rejected review request: reason=ReviewForbiddenException");
		return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "내 리뷰만 변경할 수 있어요.");
	}

	/** 다른 400과 구분해 앱이 "올릴 수 없는 사진"으로 안내하도록 {@code type}을 붙인다(D-45). */
	@ExceptionHandler(InvalidPhotoException.class)
	public ProblemDetail handleInvalidPhoto() {
		log.info("Rejected review request: reason=InvalidPhotoException");
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "올릴 수 없는 사진이 있어요.");
		problem.setType(INVALID_PHOTO_TYPE);
		return problem;
	}

	@ExceptionHandler(PhotoStorageUnavailableException.class)
	public ProblemDetail handlePhotoUnavailable(PhotoStorageUnavailableException e) {
		log.warn("Review photo storage is unavailable: reason={}",
				e.getCause() == null ? "not configured" : e.getCause().getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 사진을 올릴 수 없어요.");
	}

	@ExceptionHandler(OwnReviewReportException.class)
	public ProblemDetail handleOwnReviewReport() {
		log.info("Rejected review request: reason=OwnReviewReportException");
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "내 리뷰는 신고할 수 없어요.");
	}

	@ExceptionHandler(DuplicateReportException.class)
	public ProblemDetail handleDuplicateReport() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "이미 신고한 리뷰예요.");
	}

}
