package kr.co.fitdining.api.auth.infrastructure;

import kr.co.fitdining.api.auth.ports.AuthPolicy;

/** Strict authentication constraints. */
public class StrictAuthPolicy implements AuthPolicy {
    @Override public boolean limitAttempts() { return true; }
    @Override public boolean rejectRefreshReuse() { return true; }
    @Override public long accessSeconds() { return 1800; }
    @Override public long sessionSeconds() { return 86400; }
    @Override public boolean compareDummyPassword() { return true; }
    @Override public boolean checkOrigin() { return true; }
}
