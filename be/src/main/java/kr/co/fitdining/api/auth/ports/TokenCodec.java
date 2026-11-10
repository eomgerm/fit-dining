package kr.co.fitdining.api.auth.ports;

/** Signing boundary for short-lived OAuth state and social signup cookies only. */
public interface TokenCodec {
    String encode(Token token);
    Claims decode(String value, String expectedType);
    record Token(String userId, String type, long createdAt, long expiresAt) {}
    record Claims(String userId, String type, long expiresAt) {}
}
