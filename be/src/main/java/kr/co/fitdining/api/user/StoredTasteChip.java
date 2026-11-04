package kr.co.fitdining.api.user;

/**
 * Stored form of a taste chip in {@code user_preferences.tastes}. Never returned by the API; use {@link #chip()}.
 *
 * @param polarity like or dislike
 * @param label chip text
 * @param code feature code, null for chips the code table does not cover. Written as JSON null, not omitted;
 *        chips stored before codes existed have no {@code code} key
 * @param vector 1024-dim query embedding of {@code label}, only for LIKE chips without a code. Null when the
 *        chip needs none or embedding failed at signup
 */
public record StoredTasteChip(Preferences.Polarity polarity, String label, String code, float[] vector) {
    public static StoredTasteChip of(Preferences.TasteChip chip, float[] vector) {
        return new StoredTasteChip(chip.polarity(), chip.label(), chip.code(), vector);
    }
    public Preferences.TasteChip chip() { return new Preferences.TasteChip(polarity, label, code); }
    /** Whether this chip should carry a vector: a LIKE chip the code table does not cover. */
    public static boolean needsVector(Preferences.TasteChip chip) {
        return chip.code() == null && chip.polarity() == Preferences.Polarity.LIKE;
    }
}
