package kr.co.fitdining.api.meetup.domain;

import java.text.Normalizer;
import java.util.regex.Pattern;

/**
 * 모임 설명, 이름, 먹고 싶은 메뉴의 앞뒤 공백 제거와 길이. 공백은 FE의 {@code String.prototype.trim()}이 지우는 문자와
 * 같은 집합이고(리뷰 D-52와 같다), 길이는 코드 포인트 수로 센다.
 */
public final class MeetupText {

	private static final String SPACE = "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]";
	private static final Pattern EDGES = Pattern.compile("^" + SPACE + "+|" + SPACE + "+$");

	private MeetupText() {
	}

	/** @return 앞뒤 공백을 지운 값. null이거나 공백뿐이면 null이다. */
	public static String trimToNull(String text) {
		if (text == null) {
			return null;
		}
		String trimmed = EDGES.matcher(text).replaceAll("");
		return trimmed.isEmpty() ? null : trimmed;
	}

	public static int length(String text) {
		return text.codePointCount(0, text.length());
	}

	/**
	 * 프로필 이름. 앞뒤 공백을 지우고 NFC로 정규화한 값이고, 이 값 그대로 겹침을 본다(D-5).
	 *
	 * @return 정리한 이름. 비었거나 {@link MeetupLimits#NAME_MAX}자를 넘으면 null이다.
	 */
	public static String profileName(String raw) {
		String trimmed = trimToNull(raw);
		if (trimmed == null) {
			return null;
		}
		String name = Normalizer.normalize(trimmed, Normalizer.Form.NFC);
		return length(name) > MeetupLimits.NAME_MAX ? null : name;
	}

}
