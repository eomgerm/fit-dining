package kr.co.fitdining.api.auth.ports;

/** Signing/verification boundary. Records are transient and never persisted. */
public interface TokenCodec {
    /** @param token claims to sign @return serialized JWT */
    String encode(Token token);
    /**
     * @param value serialized JWT
     * @param expectedType access or refresh
     * @return verified claims
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure if verification fails
     */
    Claims decode(String value, String expectedType);
    /**
     * @param userId subject
     * @param jti RT identifier; null for AT
     * @param type access or refresh
     * @param createdAt issued epoch second
     * @param expiresAt expiry epoch second
     */
    record Token(String userId, String jti, String type, long createdAt, long expiresAt) {}
    /**
     * @param userId subject
     * @param jti RT identifier; null for AT
     * @param type verified type
     * @param expiresAt expiry epoch second
     */
    record Claims(String userId, String jti, String type, long expiresAt) {}
}
