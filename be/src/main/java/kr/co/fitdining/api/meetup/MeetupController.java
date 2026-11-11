package kr.co.fitdining.api.meetup;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import java.time.Duration;
import java.util.Set;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.meetup.domain.MeetupLimits;
import kr.co.fitdining.api.meetup.domain.MeetupText;
import kr.co.fitdining.api.meetup.domain.Taste;
import kr.co.fitdining.api.meetup.dto.MeetupAreasResponse;
import kr.co.fitdining.api.meetup.dto.MeetupCreateRequest;
import kr.co.fitdining.api.meetup.dto.MeetupCreateResponse;
import kr.co.fitdining.api.meetup.dto.MeetupResult;
import kr.co.fitdining.api.meetup.dto.MeetupSnapshot;
import kr.co.fitdining.api.meetup.dto.MeetupUpdateRequest;
import kr.co.fitdining.api.meetup.dto.ProfileCreateRequest;
import kr.co.fitdining.api.meetup.dto.ProfileCreateResponse;
import kr.co.fitdining.api.meetup.exception.InvalidMeetupException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 모임 API. 요청 형식만 검증하고 처리는 서비스에 맡긴다. 오류는 {@code MeetupExceptionHandler}가 ProblemDetail로
 * 바꾼다. 누가 어느 경로를 로그인 없이 부를 수 있는지는 보안 설정이 정한다(D-8). 로그인 없는 쓰기는 한도를 센다(AC-13).
 *
 * <p>인증 모듈처럼 웹 서버로 뜰 때만 만든다(리뷰 컨트롤러와 같은 이유).
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/meetups")
public class MeetupController {

	/** 모임 쿠키. 경로를 모임 API로 좁혀 모임마다 따로 실린다(D-7). */
	static final String COOKIE = "fitdining_meetup";

	private final MeetupService meetupService;
	private final MeetupProfileService profileService;
	private final MeetupCalculationService calculationService;
	private final MeetupResultService resultService;
	private final MeetupWriteLimiter writeLimiter;
	private final Validator validator;
	private final JsonMapper jsonMapper;
	private final boolean secureCookie;

	public MeetupController(MeetupService meetupService, MeetupProfileService profileService,
			MeetupCalculationService calculationService, MeetupResultService resultService,
			MeetupWriteLimiter writeLimiter, Validator validator, JsonMapper jsonMapper,
			@Value("${auth.cookie-secure}") boolean secureCookie) {
		this.meetupService = meetupService;
		this.profileService = profileService;
		this.calculationService = calculationService;
		this.resultService = resultService;
		this.writeLimiter = writeLimiter;
		this.validator = validator;
		this.jsonMapper = jsonMapper;
		this.secureCookie = secureCookie;
	}

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

	/**
	 * 모임의 지금 상태. 로그인과 프로필이 없어도 된다. 모임 쿠키가 이 모임의 프로필을 가리키면 같은 값의 쿠키를 지금 삭제
	 * 시각에 맞춰 다시 준다(AC-24). 오류: 없는 코드는 404(AC-3).
	 */
	@GetMapping("/{code}")
	public MeetupSnapshot snapshot(@PathVariable String code,
			@AuthenticationPrincipal AuthUseCases.Identity identity,
			@CookieValue(name = COOKIE, required = false) String cookie, HttpServletResponse response) {
		MeetupSnapshot snapshot = meetupService.snapshot(code, userId(identity), cookie);
		profileService.cookieLifetime(code, cookie)
				.ifPresent(maxAge -> setCookie(response, code, cookie, maxAge));
		return snapshot;
	}

	/**
	 * 모임 정보를 고친다(AC-22). 빠진 속성은 그대로 두고 null인 속성은 비운다.
	 *
	 * <p>오류: 401(인증), 400(본문, 모르는 속성, 값의 모양과 범위, 지역·업종 비우기, 고를 수 없는 지역·날짜·시간),
	 * 404(없는 코드), 403(모임장 아님), 409(`phase`).
	 */
	@PatchMapping("/{code}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void update(@PathVariable String code, @AuthenticationPrincipal AuthUseCases.Identity identity,
			@RequestBody JsonNode body) {
		String userId = identity.userId();
		MeetupUpdateRequest request = MeetupUpdateRequest.from(body, jsonMapper);
		validate(request);
		meetupService.update(code, userId, request);
	}

	/**
	 * 프로필과 모임 취향을 만들고 모임 쿠키를 준다(AC-5 ~ AC-7). 로그인 없이 된다.
	 *
	 * <p>오류: 400(본문, 이름, 취향 값), 429(로그인 없는 쓰기 한도), 404(없는 코드), 409(`already-joined`,
	 * `full`, `name-taken`).
	 */
	@PostMapping("/{code}/profiles")
	@ResponseStatus(HttpStatus.CREATED)
	public ProfileCreateResponse createProfile(@PathVariable String code,
			@AuthenticationPrincipal AuthUseCases.Identity identity, @RequestBody ProfileCreateRequest request,
			HttpServletRequest http, HttpServletResponse response) {
		validate(request);
		countAnonymous(identity, code, http);
		MeetupProfileService.Joined joined = profileService.create(code, userId(identity), request);
		setCookie(response, code, joined);
		return new ProfileCreateResponse(joined.profileId());
	}

	/**
	 * 다른 브라우저에서 자기 프로필을 고르고 모임 쿠키를 받는다(AC-8).
	 *
	 * <p>오류: 429, 404(없는 코드나 프로필), 403(남의 회원 프로필).
	 */
	@PostMapping("/{code}/profiles/{profileId}/session")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void selectProfile(@PathVariable String code, @PathVariable long profileId,
			@AuthenticationPrincipal AuthUseCases.Identity identity, HttpServletRequest http,
			HttpServletResponse response) {
		countAnonymous(identity, code, http);
		setCookie(response, code, profileService.select(code, profileId, userId(identity)));
	}

	/**
	 * 내 취향을 고친다(AC-10). 오류: 400(취향 값), 429, 404(없는 코드), 403(프로필 없음).
	 */
	@PutMapping("/{code}/profiles/me/taste")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void updateTaste(@PathVariable String code, @AuthenticationPrincipal AuthUseCases.Identity identity,
			@CookieValue(name = COOKIE, required = false) String cookie, @RequestBody Taste taste,
			HttpServletRequest http) {
		countAnonymous(identity, code, http);
		profileService.updateTaste(code, userId(identity), cookie, taste);
	}

	/**
	 * 모임장이 다른 사람의 프로필을 지운다(AC-23). 오류: 401(인증), 404(없는 코드나 프로필), 403(모임장 아님),
	 * 409(`host-profile`).
	 */
	@DeleteMapping("/{code}/profiles/{profileId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void removeProfile(@PathVariable String code, @PathVariable long profileId,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		profileService.remove(code, identity.userId(), profileId);
	}

	/**
	 * 추천받기(AC-15). 계산은 작업 스레드에서 하고, 끝났는지는 스냅숏으로 안다(D-10).
	 *
	 * <p>오류: 401(인증), 404(없는 코드), 403(모임장 아님), 409(`calculating`, `phase`).
	 */
	@PostMapping("/{code}/calculations")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public void calculate(@PathVariable String code, @AuthenticationPrincipal AuthUseCases.Identity identity) {
		calculationService.start(code, identity.userId());
	}

	/** 마지막으로 성공한 계산의 결과(AC-19). 로그인 없이 된다. 오류: 404(없는 코드, 아직 결과 없음). */
	@GetMapping("/{code}/result")
	public MeetupResult result(@PathVariable String code) {
		return resultService.result(code);
	}

	private void countAnonymous(AuthUseCases.Identity identity, String code, HttpServletRequest http) {
		if (identity == null) {
			writeLimiter.count(code, http.getRemoteAddr());
		}
	}

	private void setCookie(HttpServletResponse response, String code, MeetupProfileService.Joined joined) {
		setCookie(response, code, joined.token(), joined.maxAge());
	}

	private void setCookie(HttpServletResponse response, String code, String token, Duration maxAge) {
		response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(COOKIE, token)
				.httpOnly(true).secure(secureCookie).sameSite("Lax").path("/api/v1/meetups/" + code)
				.maxAge(maxAge).build().toString());
	}

	private static String userId(AuthUseCases.Identity identity) {
		return identity == null ? null : identity.userId();
	}

	/** {@code @Valid}는 인증보다 먼저 돌아 로그인하지 않은 요청이 400이 되므로 인증 뒤에 직접 검증한다(리뷰 D-40). */
	private <T> void validate(T request) {
		Set<ConstraintViolation<T>> violations = validator.validate(request);
		if (!violations.isEmpty()) {
			throw new ConstraintViolationException(violations);
		}
	}

}
