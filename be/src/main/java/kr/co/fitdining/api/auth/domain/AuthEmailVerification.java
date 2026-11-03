package kr.co.fitdining.api.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 가입 전 이메일 소유 확인 한 건. 인증번호와 인증 토큰은 해시로만 저장한다. */
@Entity
@Table(name = "auth_email_verifications")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthEmailVerification {
    /** 인증번호 하나에 허용하는 확인 시도 횟수. */
    public static final int MAX_ATTEMPTS = 5;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, length = 254)
    private String email;
    @Column(nullable = false)
    private String codeHash;
    @Column(nullable = false)
    private int attempts;
    @Column(nullable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private Instant expiresAt;
    private Instant verifiedAt;
    private String tokenHash;
    private Instant tokenExpiresAt;
    private Instant consumedAt;

    public AuthEmailVerification(String email, String codeHash, Instant createdAt, Instant expiresAt) {
        this.email = email;
        this.codeHash = codeHash;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    /** 틀린 인증번호를 한 번 센다. @return 이 인증번호로 더 시도할 수 없으면 true */
    public boolean recordMismatch() {
        attempts++;
        return attempts >= MAX_ATTEMPTS;
    }

    /** @return 인증번호 확인 시도를 모두 썼으면 true */
    public boolean attemptsExhausted() { return attempts >= MAX_ATTEMPTS; }

    /**
     * 인증번호가 맞았음을 기록하고 1회용 인증 토큰의 해시를 붙인다.
     * @param now 확인 시각
     * @param tokenHash 인증 토큰 해시
     * @param tokenExpiresAt 인증 토큰 만료 시각
     */
    public void verify(Instant now, String tokenHash, Instant tokenExpiresAt) {
        this.verifiedAt = now;
        this.tokenHash = tokenHash;
        this.tokenExpiresAt = tokenExpiresAt;
    }
}
