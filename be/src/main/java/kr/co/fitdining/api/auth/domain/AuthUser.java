package kr.co.fitdining.api.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Persistent User data; raw credentials and JWTs are never stored. */
@Entity
@Table(name = "auth_users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthUser {
    @Id
    private String id;
    @Column(nullable = false, length = 254)
    private String email;
    @Column(nullable = false, length = 15)
    private String nickname;
    @Column(nullable = false)
    private Instant ageConfirmedAt;
    @Column(nullable = false)
    private Instant termsAgreedAt;
    @Column(nullable = false)
    private Instant privacyAgreedAt;
    @Column(nullable = false)
    private String termsVersion;
    @Column(nullable = false)
    private String passwordHash;
    @Column(nullable = false)
    private Instant createdAt;

    private Instant deletedAt;

    /** Marks withdrawal once; retained identity fields follow the account retention policy. */
    public void withdraw(Instant now) { if (deletedAt == null) deletedAt = now; }

    public AuthUser(String id, String email, String nickname, String passwordHash, Instant createdAt, String termsVersion) {
        this.id = id;
        this.email = email;
        this.nickname = nickname;
        this.ageConfirmedAt = createdAt;
        this.termsAgreedAt = createdAt;
        this.privacyAgreedAt = createdAt;
        this.termsVersion = termsVersion;
        this.passwordHash = passwordHash;
        this.createdAt = createdAt;
    }
}
