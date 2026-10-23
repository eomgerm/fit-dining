package kr.co.fitdining.api.auth.ports;

/** Authentication API contract shared with HTTP presentation. */
public interface AuthUseCases {
    /**
     * @param email account name
     * @param password supplied password, never persisted
     * @param clientAddress direct peer address used for rate limiting
     * @return issued access and refresh tokens
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure when credentials or rate limit reject login
     */
    Issued login(String email, String password, String clientAddress);
    /**
     * @param refreshToken serialized refresh JWT
     * @return newly issued tokens in the same family
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure for invalid, expired or reused RT
     */
    Issued refresh(String refreshToken);
    /**
     * @param accessToken serialized access JWT
     * @return identity from verified claims, without database access
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure if verification fails
     */
    Identity authenticate(String accessToken);
    /**
     * @param refreshToken cookie JWT; absent or invalid values are ignored
     */
    void logout(String refreshToken);
    /** @param userId verified subject @return current account information */
    Profile me(String userId);
    /**
     * @param email normalized email
     * @param password raw password
     * @param nickname public name
     * @param clientAddress peer address
     * @return newly issued session
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure for duplicate accounts or rate limit
     */
    Issued signup(String email, String password, String nickname, String clientAddress);
    /** @param nickname public name @param email account email */
    record Profile(String nickname, String email) {}

    /**
     * @param userId user identifier
     * @param nickname public account name
     * @param sessionId RT family identifier; legacy API field name is preserved
     * @param accessExpiresAt AT expiry in epoch seconds
     * @param sessionExpiresAt absolute RT family expiry in epoch seconds
     */
    record Identity(String userId, String nickname, String sessionId, long accessExpiresAt, long sessionExpiresAt) {}
    /**
     * @param accessToken signed access JWT, never persisted
     * @param refreshToken signed refresh JWT, returned only via HttpOnly cookie
     * @param identity identity with both expiry values
     */
    record Issued(String accessToken, String refreshToken, Identity identity) {}
}
