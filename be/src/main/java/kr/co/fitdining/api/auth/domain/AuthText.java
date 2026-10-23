package kr.co.fitdining.api.auth.domain;

/** Shared normalization for API requests, service calls and demo accounts. */
public final class AuthText {
    private AuthText() {}

    /**
     * @param value input text, nullable for omitted DTO fields
     * @return text without surrounding Unicode whitespace, or null for omitted fields
     */
    public static String strip(String value) {
        if (value == null) return null;
        String stripped = value.strip();
        int start = 0;
        int end = stripped.length();
        while (start < end && whitespace(stripped.codePointAt(start))) {
            start += Character.charCount(stripped.codePointAt(start));
        }
        while (start < end && whitespace(stripped.codePointBefore(end))) {
            end -= Character.charCount(stripped.codePointBefore(end));
        }
        return stripped.substring(start, end);
    }

    private static boolean whitespace(int codePoint) {
        // String.strip excludes NBSP and other space separators that JS trim accepts.
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint) || codePoint == 0xFEFF;
    }
}
