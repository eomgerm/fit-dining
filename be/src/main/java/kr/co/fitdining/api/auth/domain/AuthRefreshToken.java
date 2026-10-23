package kr.co.fitdining.api.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Persistent RefreshToken data; raw credentials and JWTs are never stored. */
@Entity
@Table(name = "auth_refresh_tokens")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthRefreshToken {
    @Id
    private String jti;
    @Column(nullable = false)
    private String familyId;
    @Column(nullable = false)
    private String userId;
    @Column(nullable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant expiresAt;
    private Instant usedAt;
    private Instant revokedAt;
    private String revokeReason;

    public AuthRefreshToken(String jti, String familyId, String userId, Instant createdAt, Instant expiresAt) {
        this.jti = jti;
        this.familyId = familyId;
        this.userId = userId;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    /** Marks the current refresh token consumed inside its locked transaction. */
    public void markUsed(Instant now) { usedAt = now; }
}
