package kr.co.fitdining.api.review;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import kr.co.fitdining.api.review.dto.ReviewCreateRequest;
import kr.co.fitdining.api.review.dto.ReviewCreateResponse;
import kr.co.fitdining.api.review.dto.ReviewListResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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
 */
@RestController
@RequestMapping("/api/v1/places/{placeId}/reviews")
@RequiredArgsConstructor
public class ReviewController {

	private final ReviewService reviewService;

	/**
	 * 장소의 리뷰를 최신순으로 돌려준다. 인증 없이 조회한다.
	 *
	 * <p>오류: {@code placeId}가 양의 정수가 아니면 400. {@code cursor}를 해석할 수 없으면 400. 저장소가 없으면 503.
	 *
	 * @param placeId 장소 id
	 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}
	 * @return 리뷰 목록
	 */
	@GetMapping
	public ReviewListResponse list(@PathVariable @Positive long placeId,
			@RequestParam(required = false) String cursor) {
		return reviewService.list(placeId, cursor);
	}

	/**
	 * 리뷰를 등록한다. Walking Skeleton은 인증 없이 누구나 등록하고 장소 존재를 확인하지 않는다(D-15, D-21).
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있으면 400. {@code description}이 500자를 넘으면 400.
	 * {@code placeId}가 양의 정수가 아니면 400. 저장소가 없으면 503.
	 *
	 * @param placeId 장소 id
	 * @param request 등록 요청
	 * @return 등록된 리뷰 id
	 */
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public ReviewCreateResponse create(@PathVariable @Positive long placeId,
			@Valid @RequestBody ReviewCreateRequest request) {
		return reviewService.create(placeId, request);
	}

}
