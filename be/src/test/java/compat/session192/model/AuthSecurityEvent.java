package compat.session192.model;

// Snapshot of the 192 entity mapping at bab48a5; outside application entity scanning.

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

/** Persistent SecurityEvent data; raw credentials and JWTs are never stored. */
@Entity
@Table(name = "auth_security_events")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthSecurityEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false)
    private String familyId;
    @Column(nullable = false)
    private Instant createdAt;
    @Column(nullable = false)
    private String type;
    @Column(nullable = false)
    private int reuseCount;

    public AuthSecurityEvent(String familyId, Instant createdAt, String type, int reuseCount) {
        this.familyId = familyId;
        this.createdAt = createdAt;
        this.type = type;
        this.reuseCount = reuseCount;
    }
}
