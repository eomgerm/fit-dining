package kr.co.fitdining.api.auth.domain;

import java.net.URI;

public class AuthFailure extends RuntimeException {
    public static final URI ACCESS_TOKEN_EXPIRED = URI.create("urn:fitdining:auth:access-token-expired");
    private final int status;
    private final URI type;
    public AuthFailure(String message) { this(message, 401); }
    public AuthFailure(String message, int status) { this(message, status, null); }
    public AuthFailure(String message, int status, URI type) {
        super(message); this.status = status; this.type = type;
    }
    public static AuthFailure accessExpired() {
        return new AuthFailure("인증 토큰이 만료되었습니다.", 401, ACCESS_TOKEN_EXPIRED);
    }
    public int status() { return status; }
    public URI type() { return type; }
}
