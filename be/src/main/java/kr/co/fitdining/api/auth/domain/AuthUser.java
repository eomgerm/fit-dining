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
    @Column(length = 254)
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
    @Column
    private String passwordHash;
    @Column(nullable = false)
    private Instant createdAt;

    private Instant deletedAt;
    /** 가입 때 소유를 확인한 시각. 이메일 인증 도입 전 가입자와 소셜 가입자는 null이다(D4). */
    private Instant emailVerifiedAt;
    @Column(length = 254)
    private String contactEmail;
    private Instant contactEmailVerifiedAt;
    private Instant marketingAgreedAt;

    public void changeContactEmail(String email, Instant now) {
        contactEmail = email;
        contactEmailVerifiedAt = now;
    }

    public void marketingConsent(boolean agreed, Instant now) {
        if (!agreed) marketingAgreedAt = null;
        else if (marketingAgreedAt == null) marketingAgreedAt = now;
    }

    /** 이메일 소유 확인 시각을 기록한다. @param now 확인 시각 */
    public void markEmailVerified(Instant now) { if (emailVerifiedAt == null) emailVerifiedAt = now; }

    /** Marks withdrawal once; retained identity fields follow the account retention policy. */
    public void withdraw(Instant now) {
        if (deletedAt == null) deletedAt = now;
        contactEmail = null;
        contactEmailVerifiedAt = null;
        marketingAgreedAt = null;
    }

    public AuthUser(String id, String nickname, Instant createdAt, String termsVersion) {
        this(id, null, nickname, null, createdAt, termsVersion);
    }

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
