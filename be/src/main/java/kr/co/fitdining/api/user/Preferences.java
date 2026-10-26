package kr.co.fitdining.api.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;

/**
 * @param mood optional atmosphere
 * @param priorities selection criteria, empty when omitted
 * @param purposes visit purposes, empty when omitted
 * @param tastes confirmed taste chips, empty when omitted
 */
public record Preferences(Mood mood, List<@NotNull Priority> priorities,
        List<@NotNull Purpose> purposes, @Size(max = 10) List<@NotNull @Valid TasteChip> tastes) {
    public Preferences {
        priorities = priorities == null ? List.of() : priorities.stream().distinct().toList();
        purposes = purposes == null ? List.of() : purposes.stream().distinct().toList();
        tastes = tastes == null ? List.of() : tastes.stream().distinct().toList();
    }
    public enum Mood { QUIET, LIVELY }
    public enum Priority { SPACIOUS, SHORT_WAIT, GENEROUS_PORTION, PRETTY_SPACE, VIEW_OUTDOOR, COZY, VALUE }
    public enum Purpose { CONVERSATION, SOLO, DATE, GATHERING, WORK_STUDY }
    public enum Polarity { LIKE, DISLIKE }
    /** @param polarity like or dislike @param label trimmed description, 1?20 characters without controls */
    public record TasteChip(@NotNull Polarity polarity,
            @NotBlank @Size(max = 20) @Pattern(regexp = "[^\\p{Cc}]*") String label) {
        public TasteChip { label = kr.co.fitdining.api.auth.domain.AuthText.strip(label); }
    }
}
