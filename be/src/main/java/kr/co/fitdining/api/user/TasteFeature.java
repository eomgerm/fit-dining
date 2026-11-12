package kr.co.fitdining.api.user;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Computed AI profile feature stored in user_preferences.features (taste-profile spec 3·4단계).
 * A taste bundle (4단계) has no code and layer; it carries its representative phrase and vector instead.
 * @param code feature code, null for a taste bundle @param layer axis, importance, purpose or food; null for a bundle
 * @param like liked or disliked; always liked for a bundle
 * @param weight strength above 0, no upper bound; older evidence fades by later reviews. Old rows hold 1~3 integers
 * @param category RESTAURANT, CAFE or BAR for a per-category taste; null for the overall taste and in old rows
 * @param text a bundle's representative phrase, null for a code feature
 * @param vector a bundle's 1024-dim query embedding, null for a code feature
 * <p>{@code text} and {@code vector} are left out when null, whatever mapper writes the row, so a code feature keeps
 * its stored shape from before taste bundles.
 */
public record TasteFeature(String code, String layer, boolean like, double weight, String category,
        @JsonInclude(JsonInclude.Include.NON_NULL) String text,
        @JsonInclude(JsonInclude.Include.NON_NULL) float[] vector) {
    public TasteFeature(String code, String layer, boolean like, double weight, String category) {
        this(code, layer, like, weight, category, null, null);
    }
    /** Whether this element is a taste bundle rather than a code feature. */
    public boolean bundle() { return code == null; }
}
