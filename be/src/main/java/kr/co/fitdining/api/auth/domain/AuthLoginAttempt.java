package kr.co.fitdining.api.auth.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** Persistent LoginAttempt data; raw credentials and JWTs are never stored. */
@Entity
@Table(name = "auth_login_attempts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthLoginAttempt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private String address;
    @Column(nullable = false)
    private String action;
    @Column(nullable = false)
    private Instant createdAt;

    public AuthLoginAttempt(String address, String action, Instant createdAt) {
        this.address = address;
        this.action = action;
        this.createdAt = createdAt;
    }
}
