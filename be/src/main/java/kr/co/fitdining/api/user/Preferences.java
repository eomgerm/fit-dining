package kr.co.fitdining.api.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import kr.co.fitdining.api.auth.domain.AuthText;

/**
 * @param mood optional atmosphere
 * @param priorities selection criteria, empty when omitted
 * @param purposes visit purposes, empty when omitted
 * @param tastes confirmed taste chips, empty when omitted
 */
public record Preferences(Mood mood, List<@NotNull(message = "장소 선택 기준을 확인해 주세요.") Priority> priorities,
        List<@NotNull(message = "방문 목적을 확인해 주세요.") Purpose> purposes, @Size(max = 10, message = "취향은 최대 10개까지 입력해 주세요.") List<@NotNull(message = "취향 입력을 확인해 주세요.") @Valid TasteChip> tastes) {
    public Preferences {
        priorities = priorities == null ? List.of() : priorities.stream().distinct().toList();
        purposes = purposes == null ? List.of() : purposes.stream().distinct().toList();
        tastes = tastes == null ? List.of() : tastes.stream().distinct().toList();
    }
    public enum Mood { QUIET, LIVELY }
    public enum Priority { SPACIOUS, SHORT_WAIT, GENEROUS_PORTION, PRETTY_SPACE, VIEW_OUTDOOR, COZY, VALUE }
    public enum Purpose { CONVERSATION, SOLO, DATE, GATHERING, WORK_STUDY }
    public enum Polarity { LIKE, DISLIKE }
    /** @param polarity like or dislike @param label trimmed description, 1-20 characters without controls */
    public record TasteChip(@NotNull(message = "취향의 선호 여부를 확인해 주세요.") Polarity polarity,
            @NotBlank(message = "취향은 1~20자로 입력해 주세요.")
            @Size(min = 1, max = 20, message = "취향은 1~20자로 입력해 주세요.")
            @Pattern(regexp = "[^\\p{Cc}]*", message = "취향에 제어 문자를 사용할 수 없습니다.") String label,
            @Pattern(regexp = "^[A-Z][A-Z0-9_]{0,63}$", message = "취향 코드를 확인해 주세요.") String code) {
        public TasteChip(Polarity polarity, String label) { this(polarity, label, null); }
        public TasteChip { label = AuthText.strip(label); }
    }
}
