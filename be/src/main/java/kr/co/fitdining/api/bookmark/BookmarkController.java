package kr.co.fitdining.api.bookmark;

import jakarta.validation.constraints.Positive;
import java.util.List;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.bookmark.dto.BookmarkItem;
import kr.co.fitdining.api.bookmark.dto.BookmarkStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 로그인한 사용자의 장소 북마크 API(bookmark D-4). 사용자는 Bearer 토큰에서만 정하고, 처리는 {@link BookmarkService}에
 * 맡긴다. 오류는 {@code BookmarkExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>{@code placeId}가 양의 정수가 아니면 인증보다 먼저 400이다. 리뷰 컨트롤러처럼 클래스에 {@code @Validated}를
 * 붙이지 않아 Spring MVC 내장 메서드 검증이 400으로 처리한다.
 *
 * <p>리뷰 컨트롤러처럼 웹 서버로 뜰 때만 만든다. 마이그레이션 전용 {@code migrate} 프로필은 인증 빈을 만들지 않는다.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/me/bookmarks")
@RequiredArgsConstructor
public class BookmarkController {

	private static final String BEARER = "Bearer ";

	private final BookmarkService bookmarkService;
	private final AuthUseCases auth;

	/** 내 저장 장소 전체. 오류: 401(인증, 탈퇴한 사용자), 503(장소 엔진 없음), 500(그 밖의 장소 조회 실패). */
	@GetMapping
	public List<BookmarkItem> list(
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return bookmarkService.list(userId(authorization));
	}

	/** 저장 여부. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자). */
	@GetMapping("/{placeId}")
	public BookmarkStatus status(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return new BookmarkStatus(bookmarkService.isBookmarked(userId(authorization), placeId));
	}

	/** 저장. 이미 저장했어도 204다. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자), 404(없는 장소), 503(엔진 없음). */
	@PutMapping("/{placeId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void save(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		bookmarkService.save(userId(authorization), placeId);
	}

	/** 해제. 저장하지 않았어도 204다. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자). */
	@DeleteMapping("/{placeId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void remove(@PathVariable @Positive long placeId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		bookmarkService.remove(userId(authorization), placeId);
	}

	/** 인증 모듈을 직접 불러 AT에서 사용자 id를 꺼낸다. 실패하면 {@link AuthFailure}가 그대로 나간다. */
	private String userId(String authorization) {
		if (authorization == null || !authorization.startsWith(BEARER)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		return auth.authenticate(authorization.substring(BEARER.length())).userId();
	}

}
