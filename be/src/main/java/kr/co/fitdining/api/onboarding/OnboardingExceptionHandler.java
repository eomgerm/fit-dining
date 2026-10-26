package kr.co.fitdining.api.onboarding;

import kr.co.fitdining.api.auth.domain.AuthFailure;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice(basePackageClasses = OnboardingController.class)
public class OnboardingExceptionHandler {
    @ExceptionHandler({MethodArgumentNotValidException.class, HttpMessageNotReadableException.class})
    public ResponseEntity<ProblemDetail> invalid() { return problem(400, "입력 형식을 확인해주세요."); }
    @ExceptionHandler(AuthFailure.class)
    public ResponseEntity<ProblemDetail> origin(AuthFailure failure) { return problem(failure.status(), "허용되지 않은 요청 출처입니다."); }
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ProblemDetail> failure(ResponseStatusException failure) {
        return problem(failure.getStatusCode().value(), failure.getReason());
    }
    private ResponseEntity<ProblemDetail> problem(int status, String detail) {
        var response = ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON).header("Cache-Control", "no-store");
        if (status == 429) response.header("Retry-After", "900");
        return response.body(ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(status), detail));
    }
}
