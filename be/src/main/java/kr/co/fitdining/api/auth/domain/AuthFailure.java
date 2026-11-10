package kr.co.fitdining.api.auth.domain;

import java.net.URI;

public class AuthFailure extends RuntimeException {
    /** 기본 시도 제한 창(15분). 429 응답의 Retry-After 기본값이다. */
    public static final long DEFAULT_RETRY_AFTER_SECONDS = 900;
    private final int status;
    private final URI type;
    private final long retryAfterSeconds;
    public AuthFailure(String message) { this(message, 401); }
    public AuthFailure(String message, int status) { this(message, status, null); }
    public AuthFailure(String message, int status, URI type) {
        this(message, status, type, DEFAULT_RETRY_AFTER_SECONDS);
    }
    /**
     * @param message 서버 로그용 내부 메시지. 응답에 싣지 않는다
     * @param status HTTP 상태
     * @param type ProblemDetail type. 없으면 null
     * @param retryAfterSeconds 429일 때 Retry-After 값(초)
     */
    public AuthFailure(String message, int status, URI type, long retryAfterSeconds) {
        super(message); this.status = status; this.type = type; this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }
    public int status() { return status; }
    public URI type() { return type; }
    public long retryAfterSeconds() { return retryAfterSeconds; }
}
