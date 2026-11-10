package kr.co.fitdining.api.auth.infrastructure;

import kr.co.fitdining.api.auth.ports.AuthPolicy;

/** Strict authentication constraints. */
public class StrictAuthPolicy implements AuthPolicy {
    @Override public boolean limitAttempts() { return true; }
    @Override public long sessionSeconds() { return 86400; }
    @Override public long sessionIdleSeconds() { return 7200; }
    @Override public boolean compareDummyPassword() { return true; }
    @Override public boolean checkOrigin() { return true; }
}
