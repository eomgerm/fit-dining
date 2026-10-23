package kr.co.fitdining.api.auth.ports;

/** Signing/verification boundary. Token records are transient, not database entities. */
public interface TokenCodec {
    /**
     * @param token non-secret claims to sign
     * @return serialized JWT, never persisted
     */
    String encode(Token token);
    /**
     * @param value serialized JWT supplied by the client
     * @param expectedType access or refresh
     * @return verified claims
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure if verification fails
     */
    Claims decode(String value, String expectedType);

    /**
     * @param userId user identifier
     * @param username public account name
     * @param sessionId refresh family identifier (legacy API name)
     * @param jti token identifier
     * @param type access or refresh
     * @param createdAt issued time in epoch seconds
     * @param expiresAt token expiry in epoch seconds
     * @param sessionExpiresAt absolute family expiry in epoch seconds
     */
    record Token(String userId, String username, String sessionId, String jti, String type,
            long createdAt, long expiresAt, long sessionExpiresAt) {}

    /**
     * @param userId user identifier
     * @param username public account name
     * @param sessionId refresh family identifier (legacy API name)
     * @param jti token identifier
     * @param type verified token type
     * @param expiresAt token expiry in epoch seconds
     * @param sessionExpiresAt absolute family expiry in epoch seconds
     */
    record Claims(String userId, String username, String sessionId, String jti, String type,
            long expiresAt, long sessionExpiresAt) {}
}
