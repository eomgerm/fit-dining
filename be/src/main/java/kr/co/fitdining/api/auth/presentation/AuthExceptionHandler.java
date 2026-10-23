package kr.co.fitdining.api.auth.presentation;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import lombok.RequiredArgsConstructor;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ProblemDetail;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.TransactionException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import kr.co.fitdining.api.auth.domain.AuthFailure;

@Slf4j
@RequiredArgsConstructor
@RestControllerAdvice(basePackageClasses = AuthController.class)
@ConditionalOnWebApplication
public class AuthExceptionHandler {
    private final Environment environment;
    @ExceptionHandler(AuthFailure.class)
    public ResponseEntity<ProblemDetail> auth(AuthFailure failure, HttpServletRequest request, HttpServletResponse response) {
        if (request.getRequestURI().endsWith("/refresh") && failure.status() == 401)
            AuthController.clearCookie(response, Boolean.parseBoolean(environment.getRequiredProperty("auth.cookie-secure")));
        if (failure.status() == 429) response.setHeader("Retry-After", "900");
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(failure.status()),
                switch (failure.status()) {
                    case 400 -> "입력 형식을 확인해주세요.";
                    case 403 -> "허용되지 않은 요청 출처입니다.";
                    case 409 -> "이미 사용 중인 계정 정보입니다.";
                    case 429 -> "잠시 후 다시 시도해주세요.";
                    default -> "인증을 확인해주세요.";
                });
        if (failure.type() != null) problem.setType(failure.type());
        return response(problem);
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> invalidFields(MethodArgumentNotValidException failure) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "입력 형식을 확인해주세요.");
        problem.setProperty("errors", failure.getBindingResult().getFieldErrors().stream()
                .map(error -> java.util.Map.of("field", error.getField(), "reason",
                        error.getDefaultMessage() == null ? "입력 형식을 확인해 주세요." : error.getDefaultMessage())).toList());
        return response(problem);
    }
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> malformed() {
        return response(ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "입력 형식을 확인해주세요."));
    }
    @ExceptionHandler({DataAccessException.class, TransactionException.class})
    public ResponseEntity<ProblemDetail> unavailable(RuntimeException failure) {
        log.error("Authentication storage unavailable", failure);
        return response(ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "인증 저장소를 사용할 수 없습니다."));
    }
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ProblemDetail> unsupportedMediaType() {
        return response(ProblemDetail.forStatusAndDetail(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "입력 형식을 확인해주세요."));
    }
    private ResponseEntity<ProblemDetail> response(ProblemDetail problem) {
        return ResponseEntity.status(problem.getStatus()).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .header("Cache-Control", "no-store").body(problem);
    }
}
