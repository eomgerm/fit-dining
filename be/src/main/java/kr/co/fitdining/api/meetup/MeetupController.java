package kr.co.fitdining.api.meetup;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import java.util.Set;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupText;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 모임 API. 요청 형식만 검증하고 처리는 {@link MeetupService}에 맡긴다. 오류는 {@code MeetupExceptionHandler}가
 * ProblemDetail로 바꾼다. 누가 어느 경로를 로그인 없이 부를 수 있는지는 보안 설정이 정한다(D-8).
 *
 * <p>인증 모듈처럼 웹 서버로 뜰 때만 만든다(리뷰 컨트롤러와 같은 이유).
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/meetups")
@RequiredArgsConstructor
public class MeetupController {

	private final MeetupService meetupService;
	private final Validator validator;

	/**
	 * 모임을 만든다(AC-1).
	 *
	 * <p>오류: 본문을 읽을 수 없거나 정의되지 않은 속성이 있으면 인증보다 먼저 400. 그다음 401(인증), 400(필드 형식,
	 * 지역, 날짜·시간, 설명), 401(탈퇴한 회원) 순서로 확인한다.
	 */
	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public MeetupCreateResponse create(@AuthenticationPrincipal AuthUseCases.Identity identity,
			@RequestBody MeetupCreateRequest request) {
		String userId = identity.userId();
		validate(request);
		return meetupService.create(userId, request);
	}

	/** 장소가 있는 역·동을 찾는다. 오류: 401(인증), 400(찾는 말이 없거나 20자 초과). */
	@GetMapping("/areas")
	public MeetupAreasResponse areas(@AuthenticationPrincipal AuthUseCases.Identity identity,
			@RequestParam(required = false) String q) {
		String userId = identity.userId();
		String query = MeetupText.trimToNull(q);
		if (query == null || MeetupText.length(query) > MeetupLimits.AREA_QUERY_MAX) {
			throw new InvalidMeetupException();
		}
		return meetupService.areas(userId, query);
	}

	/** 모임의 지금 상태. 로그인과 프로필이 없어도 된다. 오류: 없는 코드는 404(AC-3). */
	@GetMapping("/{code}")
	public MeetupSnapshot snapshot(@PathVariable String code,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return meetupService.snapshot(code, identity == null ? null : identity.userId());
	}

	/** {@code @Valid}는 인증보다 먼저 돌아 로그인하지 않은 요청이 400이 되므로 인증 뒤에 직접 검증한다(리뷰 D-40). */
	private <T> void validate(T request) {
		Set<ConstraintViolation<T>> violations = validator.validate(request);
		if (!violations.isEmpty()) {
			throw new ConstraintViolationException(violations);
		}
	}

}
