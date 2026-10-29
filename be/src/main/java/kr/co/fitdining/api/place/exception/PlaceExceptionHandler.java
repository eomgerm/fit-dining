package kr.co.fitdining.api.place.exception;

import kr.co.fitdining.api.place.PlaceController;
import kr.co.fitdining.api.place.engine.InvalidCursorException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 장소 API의 오류를 ProblemDetail로 바꾼다. 예외 메시지에는 검색어나 요청 본문이 들어 있을 수 있어
 * detail에 넣지도, 로그에 남기지도 않는다(D-20).
 */
@Slf4j
@RestControllerAdvice(basePackageClasses = PlaceController.class)
public class PlaceExceptionHandler {

	@ExceptionHandler({
			MethodArgumentNotValidException.class,
			HandlerMethodValidationException.class,
			HttpMessageNotReadableException.class,
			MethodArgumentTypeMismatchException.class,
			MissingServletRequestParameterException.class,
			InvalidCursorException.class
	})
	public ProblemDetail handleBadRequest(Exception e) {
		log.info("Rejected place request: reason={}", e.getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않아요.");
	}

	@ExceptionHandler(PlaceNotFoundException.class)
	public ProblemDetail handleNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "장소를 찾을 수 없어요.");
	}

	@ExceptionHandler(PlaceSearchUnavailableException.class)
	public ProblemDetail handleUnavailable() {
		log.warn("Place search engine is not configured");
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 장소 검색을 쓸 수 없어요.");
	}

	/** 카탈로그 DB를 읽지 못했다. 예외 내용은 응답에 담지 않고 서버 로그에만 남긴다(D-14). */
	@ExceptionHandler(DataAccessException.class)
	public ProblemDetail handleDataAccess(DataAccessException e) {
		log.error("Place catalog access failed", e);
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 장소 검색을 쓸 수 없어요.");
	}

}
