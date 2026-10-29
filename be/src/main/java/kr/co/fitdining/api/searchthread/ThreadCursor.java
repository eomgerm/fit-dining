package kr.co.fitdining.api.searchthread;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 목록의 위치. 마지막 요청 시각 내림차순, 같으면 thread id 내림차순 정렬에서 thread 하나를 가리킨다(D-7).
 *
 * <p>문자열은 {@code <마지막 요청 시각(밀리초)>|<thread id>}를 패딩 없는 base64url로 인코딩한 값이다. FE는 내용을 해석하지 않는다.
 *
 * @param lastAt 마지막 요청 시각(밀리초)
 * @param threadId thread id
 */
record ThreadCursor(long lastAt, String threadId) {

	private static final char SEPARATOR = '|';

	String encode() {
		String plain = lastAt + String.valueOf(SEPARATOR) + threadId;
		return Base64.getUrlEncoder().withoutPadding().encodeToString(plain.getBytes(StandardCharsets.UTF_8));
	}

	/**
	 * @param cursor 직전 응답의 {@code nextCursor}
	 * @return 해석한 위치
	 * @throws InvalidSearchThreadException 패딩이 있거나, base64url이 아니거나, 내용이 형식에 맞지 않을 때
	 */
	static ThreadCursor decode(String cursor) {
		if (cursor.contains("=")) {
			throw new InvalidSearchThreadException("cursor");
		}
		String plain;
		try {
			plain = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
		} catch (IllegalArgumentException e) {
			throw new InvalidSearchThreadException("cursor");
		}
		int separatorAt = plain.indexOf(SEPARATOR);
		if (separatorAt < 0) {
			throw new InvalidSearchThreadException("cursor");
		}
		String threadId = plain.substring(separatorAt + 1);
		long lastAt;
		try {
			lastAt = Long.parseLong(plain.substring(0, separatorAt));
		} catch (NumberFormatException e) {
			throw new InvalidSearchThreadException("cursor");
		}
		if (lastAt < 0 || !TurnFormat.isThreadId(threadId)) {
			throw new InvalidSearchThreadException("cursor");
		}
		return new ThreadCursor(lastAt, threadId);
	}

}
