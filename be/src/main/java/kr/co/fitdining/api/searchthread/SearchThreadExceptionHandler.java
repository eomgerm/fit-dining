package kr.co.fitdining.api.searchthread;

import java.net.URI;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 검색 기록 API의 오류를 ProblemDetail로 바꾼다. {@code type}으로 경우를 구분한다(spec "기록 API").
 *
 * <p>본문에는 검색 문장과 취향이 들어 있어 detail에 넣지도, 로그에 남기지도 않는다(D-2의 11). DB 예외도 메시지 없이
 * 클래스 이름만 남긴다. 리뷰의 처리기는 리뷰 컨트롤러에만 걸리므로 따로 둔다.
 */
@Slf4j
@RestControllerAdvice(basePackageClasses = SearchThreadController.class)
public class SearchThreadExceptionHandler {

	static final URI INVALID = URI.create("urn:fitdining:search-thread:invalid");
	static final URI BASE_MISSING = URI.create("urn:fitdining:search-thread:base-missing");
	static final URI CONFLICT = URI.create("urn:fitdining:search-thread:conflict");
	static final URI NOT_FOUND = URI.create("urn:fitdining:search-thread:not-found");

	@ExceptionHandler(InvalidSearchThreadException.class)
	public ProblemDetail handleInvalid(InvalidSearchThreadException e) {
		log.info("Rejected search thread request: reason=invalid, rule={}", e.getMessage());
		return problem(HttpStatus.BAD_REQUEST, INVALID, "요청 형식이 올바르지 않아요.");
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ProblemDetail handleUnreadable() {
		log.info("Rejected search thread request: reason=unreadable");
		return problem(HttpStatus.BAD_REQUEST, INVALID, "요청 형식이 올바르지 않아요.");
	}

	/** FE가 토큰 만료를 알아보고 갱신하도록 상태 코드와 {@code type}을 그대로 둔다(리뷰와 같은 모양). */
	@ExceptionHandler(AuthFailure.class)
	public ProblemDetail handleAuthFailure(AuthFailure failure) {
		log.info("Rejected search thread request: reason=AuthFailure, status={}", failure.status());
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(failure.status()),
				"로그인이 필요해요.");
		if (failure.type() != null) {
			problem.setType(failure.type());
		}
		return problem;
	}

	@ExceptionHandler(BaseTurnMissingException.class)
	public ProblemDetail handleBaseMissing() {
		return problem(HttpStatus.CONFLICT, BASE_MISSING, "이어서 검색할 요청이 아직 저장되지 않았어요.");
	}

	@ExceptionHandler(TurnConflictException.class)
	public ProblemDetail handleConflict() {
		return problem(HttpStatus.CONFLICT, CONFLICT, "같은 요청이 다른 내용으로 이미 저장돼 있어요.");
	}

	@ExceptionHandler(SearchThreadNotFoundException.class)
	public ProblemDetail handleNotFound() {
		return problem(HttpStatus.NOT_FOUND, NOT_FOUND, "검색 기록을 찾을 수 없어요.");
	}

	/** 그 밖의 오류. 메시지에 본문이나 SQL 값이 들어 있을 수 있어 클래스 이름만 남긴다 */
	@ExceptionHandler(Exception.class)
	public ProblemDetail handleUnexpected(Exception e) {
		log.error("Search thread request failed: reason={}", e.getClass().getName());
		return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "요청을 처리하지 못했어요.");
	}

	private static ProblemDetail problem(HttpStatus status, URI type, String detail) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
		problem.setType(type);
		return problem;
	}

}
