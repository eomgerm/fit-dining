package kr.co.fitdining.api.review;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장소별 리뷰 목록과 등록 API. 요청 형식만 검증하고 처리는 {@link ReviewService}에 맡긴다.
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
@RequestMapping("/api/v1/places/{placeId}/reviews")
@RequiredArgsConstructor
public class ReviewController {

	private static final String BEARER = "Bearer ";

	private final ReviewService reviewService;
	private final AuthUseCases auth;

	/**
	 * 장소의 리뷰를 최신순으로 돌려준다. 인증 없이 조회한다.
	 *
	 * <p>오류: {@code placeId}가 양의 정수가 아니면 400. {@code cursor}를 해석할 수 없으면 400.
	 *
	 * @param placeId 장소 id
	 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}
	 * @return 리뷰 목록. 리뷰 수는 첫 페이지에만 있다.
	 */
	@GetMapping
	public ReviewListResponse list(@PathVariable @Positive long placeId,
			@RequestParam(required = false) String cursor) {
		return reviewService.list(placeId, cursor);
	}

	/**
	 * 로그인한 사용자의 리뷰를 등록한다. 장소 존재는 아직 확인하지 않는다(D-15, D-21).
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있으면 400. {@code description}이 500자를 넘으면 400.
	 * {@code placeId}가 양의 정수가 아니면 400. {@code Authorization} 헤더가 없거나 토큰이 유효하지 않으면 401
	 * (만료면 {@code type}이 {@code urn:fitdining:auth:access-token-expired}). 같은 장소에 오늘 이미 썼으면 409.
	 *
	 * @param placeId 장소 id
	 * @param authorization {@code Bearer <AT>}
	 * @param request 등록 요청
	 * @return 등록된 리뷰 id
	 */
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public ReviewCreateResponse create(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization,
			@Valid @RequestBody ReviewCreateRequest request) {
		return reviewService.create(placeId, userId(authorization), request);
	}

	/** 인증 모듈을 직접 불러 AT에서 사용자 id를 꺼낸다. 실패하면 {@link AuthFailure}가 그대로 나간다. */
	private String userId(String authorization) {
		if (authorization == null || !authorization.startsWith(BEARER)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		return auth.authenticate(authorization.substring(BEARER.length())).userId();
	}

}
