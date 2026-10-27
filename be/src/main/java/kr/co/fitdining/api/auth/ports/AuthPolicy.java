package kr.co.fitdining.api.auth.ports;

/** Runtime authentication constraints shared by email and social flows. */
public interface AuthPolicy {
    /** @return whether attempts must be persisted and limited */
    boolean limitAttempts();
    /** @return whether a used refresh token triggers family revocation */
    boolean rejectRefreshReuse();
    /** @return access token lifetime in seconds */
    long accessSeconds();
    /** @return absolute refresh family lifetime in seconds */
    long sessionSeconds();
    /** @return whether unknown accounts require a dummy password comparison */
    boolean compareDummyPassword();
    /** @return whether POST requests require the configured Origin */
    boolean checkOrigin();
}
