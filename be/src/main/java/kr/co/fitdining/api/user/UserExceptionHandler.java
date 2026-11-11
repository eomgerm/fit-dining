package kr.co.fitdining.api.user;

import kr.co.fitdining.api.auth.domain.AuthFailure;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.dao.DataAccessException;

@RestControllerAdvice(basePackageClasses = UserController.class)
public class UserExceptionHandler {
    @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> invalidFields(org.springframework.web.bind.MethodArgumentNotValidException failure) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "입력 형식을 확인해주세요.");
        problem.setProperty("errors", failure.getBindingResult().getFieldErrors().stream()
                .map(error -> java.util.Map.of("field", error.getField(), "reason",
                        error.getDefaultMessage() == null ? "입력 형식을 확인해 주세요." : error.getDefaultMessage())).toList());
        return response(problem);
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ProblemDetail> malformed(org.springframework.http.converter.HttpMessageNotReadableException failure) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "입력 형식을 확인해주세요.");
        StringBuilder field = new StringBuilder();
        if (failure.getCause() instanceof tools.jackson.core.JacksonException mapping) {
            for (var part : mapping.getPath()) {
                if (part.getPropertyName() != null) {
                    if (!field.isEmpty()) field.append('.');
                    field.append(part.getPropertyName());
                } else if (part.getIndex() >= 0) field.append('[').append(part.getIndex()).append(']');
            }
        }
        problem.setProperty("errors", java.util.List.of(java.util.Map.of(
                "field", field.isEmpty() ? "body" : field.toString(), "reason", "입력 형식을 확인해 주세요.")));
        return response(problem);
    }

    @ExceptionHandler(AuthFailure.class)
    public ResponseEntity<ProblemDetail> auth(AuthFailure failure) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(failure.status()),
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
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ProblemDetail> status(ResponseStatusException failure) {
        return response(ProblemDetail.forStatusAndDetail(failure.getStatusCode(), failure.getReason()));
    }
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ProblemDetail> storage() {
        return response(ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE, "저장소를 사용할 수 없습니다."));
    }
    private ResponseEntity<ProblemDetail> response(ProblemDetail problem) {
        return ResponseEntity.status(problem.getStatus()).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .header("Cache-Control", "no-store").body(problem);
    }
}
