package kr.co.fitdining.api.user;

/** Computed AI profile feature stored in user_preferences.features. */
public record TasteFeature(String code, String layer, boolean like, int weight) {}
