package kr.co.fitdining.api.auth.infrastructure;

import kr.co.fitdining.api.auth.ports.AuthPolicy;

/** Simple authentication constraints. */
public class SimpleAuthPolicy implements AuthPolicy {
    private final boolean local;
    public SimpleAuthPolicy(boolean local) { this.local = local; }
    @Override public boolean limitAttempts() { return false; }
    @Override public long sessionSeconds() { return 2592000; }
    @Override public long sessionIdleSeconds() { return 43200; }
    @Override public boolean compareDummyPassword() { return false; }
    @Override public boolean checkOrigin() { return !local; }
}
