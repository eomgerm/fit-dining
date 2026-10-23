package kr.co.fitdining.api.auth.ports;

/** Password cryptography boundary, called outside database transactions. */
public interface PasswordHasher {
    /**
     * @param password raw password, never logged or persisted
     * @return BCrypt hash suitable for persistence
     */
    String hash(String password);
    /**
     * @param password supplied password
     * @param hash persisted hash or a dummy hash for unknown users
     * @return whether the supplied password matches
     */
    boolean matches(String password, String hash);
}
