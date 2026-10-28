package kr.co.fitdining.api.review;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Positive;
import java.util.Set;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewDetailResponse;
import kr.co.fitdining.api.review.dto.ReviewFormResponse;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import kr.co.fitdining.api.review.dto.ReviewUpdateRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장소별 리뷰 목록·등록·작성 화면 데이터와 내 리뷰 조회·수정·삭제 API. 요청 형식만 검증하고 처리는
 * {@link ReviewService}에 맡긴다.
 * 오류는 {@code ReviewExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>클래스에 {@code @Validated}를 붙이지 않는다. 붙이면 Spring MVC 내장 메서드 검증이 꺼져
 * {@code placeId} 검증이 400으로 처리되지 않는다(검색 D-59).
 *
 * <p>인증 모듈처럼 웹 서버로 뜰 때만 만든다. 마이그레이션 전용 {@code migrate} 프로필은 웹 서버 없이 뜨고 인증 빈을
 * 만들지 않으므로, 여기서 인증을 요구하면 마이그레이션 뒤 기동이 실패한다.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class ReviewController {

	private static final String BEARER = "Bearer ";

	private final ReviewService reviewService;
	private final AuthUseCases auth;
	private final Validator validator;

	/**
	 * 장소의 리뷰를 최신순으로 돌려준다. 로그인은 선택이고, 로그인했으면 내 리뷰에 {@code mine}이 붙는다(D-42).
	 *
	 * <p>오류: {@code placeId}가 양의 정수가 아니면 400. {@code cursor}를 해석할 수 없으면 400.
	 * {@code Authorization} 헤더가 있는데 토큰이 유효하지 않으면 401. 없는 장소면 404.
	 *
	 * @param placeId 장소 id
	 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}
	 * @param authorization 선택. {@code Bearer <AT>}
	 * @return 리뷰 목록. 리뷰 수는 첫 페이지에만 있다.
	 */
	@GetMapping("/places/{placeId}/reviews")
	public ReviewListResponse list(@PathVariable @Positive long placeId,
			@RequestParam(required = false) String cursor,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return reviewService.list(placeId, cursor, authorization == null ? null : userId(authorization));
	}

	/**
	 * 로그인한 사용자의 리뷰를 등록한다(D-15, D-40).
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있으면 400. {@code placeId}가 양의 정수가 아니면 400.
	 * {@code Authorization} 헤더가 없거나 토큰이 유효하지 않으면 401(만료면 {@code type}이
	 * {@code urn:fitdining:auth:access-token-expired}). 인증 뒤 필드 형식, 방문일 범위, 태그 규칙이 틀리면 400.
	 * 없는 장소면 404. 같은 장소에 같은 방문일로 이미 썼으면 409.
	 *
	 * @param placeId 장소 id
	 * @param authorization {@code Bearer <AT>}
	 * @param request 등록 요청
	 * @return 등록된 리뷰 id
	 */
	@PostMapping("/places/{placeId}/reviews")
	@ResponseStatus(HttpStatus.CREATED)
	public ReviewCreateResponse create(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization,
			@RequestBody ReviewCreateRequest request) {
		String userId = userId(authorization);
		validate(request);
		return reviewService.create(placeId, userId, request);
	}

	/** 로그인한 사용자의 작성 화면 데이터. 오류: 401(인증), 404(없는 장소), 503(장소 검색 불가). */
	@GetMapping("/places/{placeId}/review-form")
	public ReviewFormResponse reviewForm(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return reviewService.reviewForm(placeId, userId(authorization));
	}

	/**
	 * 수정 화면이 쓰는 내 리뷰(D-44). 오류: {@code reviewId}가 양의 정수가 아니면 인증보다 먼저 400. 401(인증, 탈퇴한
	 * 사용자), 404(없거나 삭제한 리뷰), 403(남의 리뷰) 순서로 확인한다.
	 */
	@GetMapping("/reviews/{reviewId}")
	public ReviewDetailResponse detail(@PathVariable @Positive long reviewId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return reviewService.detail(reviewId, userId(authorization));
	}

	/**
	 * 내 리뷰의 본문을 고친다(D-6, D-44). 등록처럼 인증한 뒤 필드 형식을 검증한다.
	 *
	 * <p>오류: 본문을 읽을 수 없거나, 다른 필드(방문일, 태그, 1인당 금액 등)가 있거나, {@code reviewId}가 양의 정수가
	 * 아니면 인증보다 먼저 400이다. 그다음 401(인증), 400(본문이 없거나 500자 초과), 401(탈퇴한 사용자),
	 * 404(없거나 삭제한 리뷰), 403(남의 리뷰) 순서로 확인한다.
	 */
	@PatchMapping("/reviews/{reviewId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void update(@PathVariable @Positive long reviewId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization,
			@RequestBody ReviewUpdateRequest request) {
		String userId = userId(authorization);
		validate(request);
		reviewService.update(reviewId, userId, request);
	}

	/**
	 * 내 리뷰를 지운다(D-28, D-44). 오류: {@code reviewId} 형식(400), 401(인증, 탈퇴한 사용자), 404(없거나 이미 삭제한
	 * 리뷰), 403(남의 리뷰).
	 */
	@DeleteMapping("/reviews/{reviewId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void delete(@PathVariable @Positive long reviewId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		reviewService.delete(reviewId, userId(authorization));
	}

	/** {@code @Valid}는 인증보다 먼저 돌아 로그인하지 않은 요청이 400이 되므로 인증 뒤에 직접 검증한다(D-40). */
	private <T> void validate(T request) {
		Set<ConstraintViolation<T>> violations = validator.validate(request);
		if (!violations.isEmpty()) {
			throw new ConstraintViolationException(violations);
		}
	}

	/** 인증 모듈을 직접 불러 AT에서 사용자 id를 꺼낸다. 실패하면 {@link AuthFailure}가 그대로 나간다. */
	private String userId(String authorization) {
		if (authorization == null || !authorization.startsWith(BEARER)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		return auth.authenticate(authorization.substring(BEARER.length())).userId();
	}

}
