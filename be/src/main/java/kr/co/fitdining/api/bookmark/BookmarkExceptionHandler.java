package kr.co.fitdining.api.bookmark;

import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.place.exception.PlaceNotFoundException;
import kr.co.fitdining.api.place.exception.PlaceSearchUnavailableException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 북마크 API의 오류를 ProblemDetail로 바꾼다(bookmark D-4). 북마크 컨트롤러에만 걸린다. 장소·리뷰 처리기가 걸리지 않게
 * 이 패키지는 {@code api.place}, {@code api.review} 밖에 있다.
 */
@Slf4j
@RestControllerAdvice(basePackageClasses = BookmarkController.class)
public class BookmarkExceptionHandler {

	@ExceptionHandler({HandlerMethodValidationException.class, MethodArgumentTypeMismatchException.class})
	public ProblemDetail handleBadRequest(Exception e) {
		log.info("Rejected bookmark request: reason={}", e.getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않아요.");
	}

	/** FE가 토큰 만료를 알아보고 갱신하도록 상태 코드와 {@code type}을 그대로 둔다. */
	@ExceptionHandler(AuthFailure.class)
	public ProblemDetail handleAuthFailure(AuthFailure failure) {
		log.info("Rejected bookmark request: reason=AuthFailure, status={}", failure.status());
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
		log.warn("Place lookup is unavailable for bookmark");
		return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "지금은 저장한 장소를 쓸 수 없어요.");
	}

	/**
	 * Spring이 원래 상태 코드를 정해 둔 요청 오류(405, 415 등)는 그 상태 그대로 두고, 나머지는 500이다. 예외 메시지에는
	 * 내부 정보가 있을 수 있어 detail에 넣지 않는다.
	 */
	@ExceptionHandler(Exception.class)
	public ResponseEntity<ProblemDetail> handleUnexpected(Exception e) {
		if (e instanceof ErrorResponse response) {
			return ResponseEntity.status(response.getStatusCode()).headers(response.getHeaders())
					.body(response.getBody());
		}
		log.error("Unexpected bookmark failure", e);
		return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
				.body(ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "잠시 후 다시 시도해 주세요."));
	}

}
