package kr.co.fitdining.api.user;

/**
 * Computed AI profile feature stored in user_preferences.features (taste-profile spec 3·4단계).
 * @param code feature code @param layer axis, importance, purpose or food @param like liked or disliked
 * @param weight strength above 0, no upper bound; older evidence fades by later reviews. Old rows hold 1~3 integers
 * @param category RESTAURANT, CAFE or BAR for a per-category taste; null for the overall taste and in old rows
 */
public record TasteFeature(String code, String layer, boolean like, double weight, String category) {}
