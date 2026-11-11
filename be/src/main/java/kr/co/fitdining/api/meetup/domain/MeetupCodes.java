package kr.co.fitdining.api.meetup.domain;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;

/** 모임 코드. 무작위 128비트를 base64url(패딩 없음)로 쓴 22자다(D-2). */
public final class MeetupCodes {

	private static final SecureRandom RANDOM = new SecureRandom();
	private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9_-]{22}");

	private MeetupCodes() {
	}

	public static String generate() {
		byte[] bytes = new byte[16];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	/** 형식이 틀린 코드는 DB를 보지 않고 없는 코드(404)로 답한다. */
	public static boolean wellFormed(String code) {
		return code != null && FORMAT.matcher(code).matches();
	}

}
