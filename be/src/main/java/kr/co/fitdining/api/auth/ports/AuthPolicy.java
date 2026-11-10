package kr.co.fitdining.api.auth.ports;

/** Runtime authentication constraints shared by email and social flows. */
public interface AuthPolicy {
    /** @return whether attempts must be persisted and limited */
    boolean limitAttempts();
    /** @return absolute session lifetime in seconds */
    long sessionSeconds();
    /** @return HTTP session idle lifetime in seconds */
    long sessionIdleSeconds();
    /** @return whether unknown accounts require a dummy password comparison */
    boolean compareDummyPassword();
    /** @return whether POST requests require the configured Origin */
    boolean checkOrigin();
}
