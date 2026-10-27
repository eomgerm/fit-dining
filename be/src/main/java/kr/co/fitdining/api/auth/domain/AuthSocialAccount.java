package kr.co.fitdining.api.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** One provider identity belongs to one independent local account. */
@Entity
@Table(name = "auth_social_accounts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AuthSocialAccount {
    @EmbeddedId
    private Key id;
    @Column(nullable = false, unique = true)
    private String userId;
    @Column(nullable = false)
    private Instant createdAt;

    public AuthSocialAccount(Key id, String userId, Instant createdAt) {
        this.id = id;
        this.userId = userId;
        this.createdAt = createdAt;
    }

    /** Composite provider identity; no email linking is performed. */
    @Embeddable
    @NoArgsConstructor
    public static class Key implements Serializable {
        @Column(nullable = false)
        private String provider;
        @Column(nullable = false)
        private String providerUserId;

        public Key(String provider, String providerUserId) {
            this.provider = provider;
            this.providerUserId = providerUserId;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Key key && Objects.equals(provider, key.provider)
                    && Objects.equals(providerUserId, key.providerUserId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(provider, providerUserId);
        }
    }
}
