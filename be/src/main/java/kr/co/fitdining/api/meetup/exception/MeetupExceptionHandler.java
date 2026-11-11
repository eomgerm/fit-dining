package kr.co.fitdining.api.meetup.exception;

import jakarta.validation.ConstraintViolationException;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.meetup.MeetupController;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 모임 API의 오류를 ProblemDetail로 바꾼다(D-9). 예외 메시지에는 모임 설명이나 이름이 들어 있을 수 있어 detail에
 * 넣지도, 로그에 남기지도 않는다(D-8).
 */
@Slf4j
@RestControllerAdvice(basePackageClasses = MeetupController.class)
public class MeetupExceptionHandler {

	@ExceptionHandler({
			MethodArgumentNotValidException.class,
			HandlerMethodValidationException.class,
			HttpMessageNotReadableException.class,
			MethodArgumentTypeMismatchException.class,
			MissingServletRequestParameterException.class,
			ConstraintViolationException.class,
			InvalidMeetupException.class
	})
	public ProblemDetail handleBadRequest(Exception e) {
		log.info("Rejected meetup request: reason={}", e.getClass().getSimpleName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "요청 형식이 올바르지 않아요.");
	}

	/** 인증 모듈의 처리기는 인증 API에만 걸려 있어 모임이 직접 바꾼다. */
	@ExceptionHandler(AuthFailure.class)
	public ProblemDetail handleAuthFailure(AuthFailure failure) {
		log.info("Rejected meetup request: reason=AuthFailure, status={}", failure.status());
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(failure.status()),
				"로그인이 필요해요.");
		if (failure.type() != null) {
			problem.setType(failure.type());
		}
		return problem;
	}

	@ExceptionHandler(MeetupNotFoundException.class)
	public ProblemDetail handleNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "없거나 끝난 모임이에요.");
	}

	@ExceptionHandler(MeetupProfileNotFoundException.class)
	public ProblemDetail handleProfileNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "프로필을 찾을 수 없어요.");
	}

	@ExceptionHandler(MeetupForbiddenException.class)
	public ProblemDetail handleForbidden() {
		log.info("Rejected meetup request: reason=MeetupForbiddenException");
		return ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, "이 모임에서 할 수 없는 동작이에요.");
	}

	/** 같은 409 안에서 FE가 안내를 고르도록 {@code type}을 붙인다(D-9). */
	@ExceptionHandler(MeetupConflictException.class)
	public ProblemDetail handleConflict(MeetupConflictException e) {
		log.info("Rejected meetup request: reason={}", e.conflict());
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.conflict().detail());
		problem.setType(e.conflict().type());
		if (e.phase() != null) {
			problem.setProperty("phase", e.phase());
		}
		return problem;
	}

	@ExceptionHandler(MeetupResultNotFoundException.class)
	public ProblemDetail handleResultNotFound() {
		return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "아직 추천 결과가 없어요.");
	}

	@ExceptionHandler(TooManyMeetupWritesException.class)
	public ProblemDetail handleTooManyWrites() {
		log.info("Rejected meetup request: reason=TooManyMeetupWritesException");
		return ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, "잠시 뒤 다시 시도해 주세요.");
	}

}
