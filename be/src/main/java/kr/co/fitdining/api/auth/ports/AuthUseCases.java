package kr.co.fitdining.api.auth.ports;

/** Authentication API contract shared with HTTP presentation. */
public interface AuthUseCases {
    /**
     * @param email account name
     * @param password supplied password, never persisted
     * @param clientAddress direct peer address used for rate limiting
     * @return new session identity
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure when credentials or rate limit reject login
     */
    Issued login(String email, String password, String clientAddress);
    /** Records logout; the HTTP boundary invalidates the current session. */
    void logout(String userId);
    /** Records success only after the HTTP session has been established. */
    void sessionEstablished(String userId);
    /** @param userId verified subject @return current account information */
    Profile me(String userId);
    /**
     * @param email normalized email
     * @param password raw password
     * @param nickname public name
     * @param verificationToken one-time token from email verification; absent or unusable values are rejected
     * @param clientAddress peer address
     * @return newly issued session
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure for duplicate accounts, missing verification or rate limit
     */
    Issued signup(String email, String password, String nickname, String verificationToken, String clientAddress);
    /** @param email email @param password password @param nickname nickname
     * @param verificationToken one-time email verification token @param clientAddress peer address
     * @param preferences optional onboarding answers @return session
     * @throws kr.co.fitdining.api.auth.domain.AuthFailure if signup fails */
    Issued signup(String email, String password, String nickname, String verificationToken, String clientAddress,
            kr.co.fitdining.api.user.Preferences preferences);
    Issued signup(String email, String password, String nickname, String verificationToken, String clientAddress,
            kr.co.fitdining.api.user.Preferences preferences, boolean marketing);
    /** @param nickname public name @param email account email */
    record Profile(String nickname, String email) {}

    /** Session principal; old deployments may have persisted additional token fields. */
    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    record Identity(String userId, String nickname, long sessionExpiresAt) implements java.security.Principal {
        @com.fasterxml.jackson.annotation.JsonIgnore public String getName() { return userId; }
    }
    record Issued(Identity identity) {}
}
