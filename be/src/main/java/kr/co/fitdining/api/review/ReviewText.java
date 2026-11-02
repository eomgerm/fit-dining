package kr.co.fitdining.api.review;

import java.util.regex.Pattern;

/** 리뷰 본문과 신고 설명의 공백 판단. FE의 {@code String.prototype.trim()}이 지우는 문자와 같은 집합을 쓴다(D-52). */
public final class ReviewText {

	private static final Pattern BLANK = Pattern.compile(
			"[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]*");

	private ReviewText() {
	}

	/** 비었거나 FE가 공백으로 보는 문자뿐이면 참이다. */
	public static boolean isBlank(String text) {
		return text == null || BLANK.matcher(text).matches();
	}

}
