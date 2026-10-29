package kr.co.fitdining.api.searchthread;

import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회원의 검색 기록(thread) API(search-thread D-3). 모든 경로는 로그인이 필요하고 사용자는 토큰에서만 얻는다.
 *
 * <p>판단 순서는 인증과 탈퇴 확인(401), 그다음 id·cursor·본문 형식(400)이다. 그래서 본문은 DTO로 바인딩하지 않고 바이트로
 * 받아 인증 뒤에 읽는다(D-4). 오류는 {@code SearchThreadExceptionHandler}가 ProblemDetail로 바꾸고, 모든 응답에
 * {@code Cache-Control: no-store}가 붙는다(인증 모듈의 웹 설정).
 *
 * <p>리뷰처럼 웹 서버로 뜰 때만 만든다. 마이그레이션 전용 {@code migrate} 프로필은 인증 빈을 만들지 않는다.
 */
@RestController
@ConditionalOnWebApplication
@RequestMapping("/api/v1/me/search-threads")
@RequiredArgsConstructor
public class SearchThreadController {

	private static final String BEARER = "Bearer ";

	private final SearchThreadService service;
	private final AuthUseCases auth;

	/**
	 * 최근 검색 목록. 오류: 401(인증, 탈퇴), 400(cursor 형식).
	 *
	 * @param cursor 다음 페이지 요청일 때, 직전 응답의 {@code nextCursor}
	 */
	@GetMapping
	public ThreadPage list(@RequestParam(required = false) String cursor,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		return service.page(activeUser(authorization), cursor);
	}

	/** thread 하나. 오류: 401(인증, 탈퇴), 400(id 형식), 404(내 계정에 없음). */
	@GetMapping("/{threadId}")
	public ResponseEntity<byte[]> thread(@PathVariable String threadId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
		String userId = activeUser(authorization);
		TurnFormat.requireThreadId(threadId);
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(service.thread(userId, threadId));
	}

	/**
	 * turn 하나를 더한다. thread의 첫 turn이면 thread를 만든다. 오류: 401(인증, 탈퇴), 400(형식, thread 규칙),
	 * 409(같은 id 다른 내용, 기준 turn 없음).
	 */
	@PutMapping("/{threadId}/turns/{turnId}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void addTurn(@PathVariable String threadId, @PathVariable String turnId,
			@RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization,
			@RequestBody(required = false) byte[] body) {
		String userId = activeUser(authorization);
		TurnFormat.requireThreadId(threadId);
		service.addTurn(userId, threadId, TurnFormat.parse(turnId, body));
	}

	/** 인증 모듈을 직접 불러 AT에서 사용자 id를 꺼내고, 탈퇴하지 않은 회원인지 확인한다. */
	private String activeUser(String authorization) {
		if (authorization == null || !authorization.startsWith(BEARER)) {
			throw new AuthFailure("로그인이 필요합니다.");
		}
		String userId = auth.authenticate(authorization.substring(BEARER.length())).userId();
		service.requireActiveUser(userId);
		return userId;
	}

}
