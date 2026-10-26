package kr.co.fitdining.api.user;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.List;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One preference row per account; arrays and JSON use PostgreSQL native types. */
@Entity @Table(name = "user_preferences") @Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserPreferences {
    @Id private String userId;
    private String mood;
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(columnDefinition = "text[]") private String[] priorities;
    @JdbcTypeCode(SqlTypes.ARRAY) @Column(columnDefinition = "text[]") private String[] purposes;
    @JdbcTypeCode(SqlTypes.JSON) @Column(columnDefinition = "jsonb") private List<Preferences.TasteChip> tastes;
    private Instant createdAt;
    private Instant updatedAt;
    public UserPreferences(String userId, Preferences value, Instant now) {
        this.userId = userId;
        mood = value.mood() == null ? null : value.mood().name();
        priorities = value.priorities().stream().map(Enum::name).toArray(String[]::new);
        purposes = value.purposes().stream().map(Enum::name).toArray(String[]::new);
        tastes = value.tastes(); createdAt = now; updatedAt = now;
    }
}
