package kr.co.fitdining.api.bookmark;

import org.springframework.security.core.annotation.AuthenticationPrincipal;

import jakarta.validation.constraints.Positive;
import java.util.List;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.bookmark.dto.BookmarkItem;
import kr.co.fitdining.api.bookmark.dto.BookmarkStatusResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 로그인한 사용자의 장소 북마크 API(bookmark D-4). 사용자는 세션 인증 주체로 정하고, 처리는 {@link BookmarkService}에
 * 맡긴다. 오류는 {@code BookmarkExceptionHandler}가 ProblemDetail로 바꾼다.
 *
 * <p>Security 필터에서 인증한 뒤 {@code placeId}가 양의 정수가 아니면 400이다. 리뷰 컨트롤러처럼 클래스에 {@code @Validated}를
 * 붙이지 않아 Spring MVC 내장 메서드 검증이 400으로 처리한다.
 *
 * <p>리뷰 컨트롤러처럼 웹 서버로 뜰 때만 만든다. 마이그레이션 전용 {@code migrate} 프로필은 인증 빈을 만들지 않는다.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/me/bookmarks")
@RequiredArgsConstructor
public class BookmarkController {


	private final BookmarkService bookmarkService;

	/** 내 저장 장소 전체. 오류: 401(인증, 탈퇴한 사용자), 503(장소 엔진 없음), 500(그 밖의 장소 조회 실패). */
	@GetMapping
	public List<BookmarkItem> list(
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return bookmarkService.list(identity.userId());
	}

	/** 저장 여부. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자). */
	@GetMapping("/{placeId}")
	public BookmarkStatusResponse status(@PathVariable @Positive long placeId,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		return new BookmarkStatusResponse(bookmarkService.isBookmarked(identity.userId(), placeId));
	}

	/** 저장. 이미 저장했어도 204다. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자), 404(없는 장소), 503(엔진 없음). */
	@PutMapping("/{placeId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void save(@PathVariable @Positive long placeId,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		bookmarkService.save(identity.userId(), placeId);
	}

	/** 해제. 저장하지 않았어도 204다. 오류: 400({@code placeId}), 401(인증, 탈퇴한 사용자). */
	@DeleteMapping("/{placeId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void remove(@PathVariable @Positive long placeId,
			@AuthenticationPrincipal AuthUseCases.Identity identity) {
		bookmarkService.remove(identity.userId(), placeId);
	}


}
