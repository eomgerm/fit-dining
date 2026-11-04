package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import kr.co.fitdining.api.user.*;
import kr.co.fitdining.api.user.Preferences.Polarity;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
class TasteProfileServiceTests {
    final AiTasteClient client = mock(AiTasteClient.class);
    final Preferences answers = new Preferences(Preferences.Mood.QUIET, null, null, null);
    final Preferences chips = new Preferences(null, null, null, List.of(
            new TasteChip(Polarity.LIKE, "국물", null),
            new TasteChip(Polarity.LIKE, "조용한", "QUIET"),
            new TasteChip(Polarity.DISLIKE, "매운", null),
            new TasteChip(Polarity.LIKE, "창가", null)));
    final float[] soup = {0.1f}, window = {0.2f};

    @Test void disabledOrMissingPreferences_neverCallsAi() {
        var disabled = new TasteProfileService(client, false).compute(chips);
        assertEquals(List.of(), disabled.features());
        assertEquals(4, disabled.tastes().size());
        assertTrue(disabled.tastes().stream().allMatch(chip -> chip.vector() == null));
        assertEquals(new TasteProfileService.Profile(List.of(), List.of()), new TasteProfileService(client, true).compute(null));
        verifyNoInteractions(client);
    }
    @Test void success_returnsFeatures() {
        var features = List.of(new TasteFeature("QUIET", "axis", true, 1));
        when(client.profile(answers)).thenReturn(features);
        assertEquals(features, new TasteProfileService(client, true).compute(answers).features());
        verify(client).profile(answers);
        verify(client, never()).vectors(any());
    }
    @Test void failure_hasEmptyFallbackWithoutPayloadLogs(org.springframework.boot.test.system.CapturedOutput output) {
        when(client.profile(answers)).thenThrow(new IllegalStateException("sensitive payload"));
        assertEquals(List.of(), new TasteProfileService(client, true).compute(answers).features());
        assertFalse(output.getAll().contains("sensitive payload"));
        assertTrue(output.getAll().contains("IllegalStateException"));
    }
    @Test @DisplayName("칩 벡터_코드 없는 좋아함 칩_순서대로 벡터가 붙음")
    void compute_uncodedLikeChips_getVectorsInOrder() {
        when(client.vectors(List.of("국물", "창가"))).thenReturn(List.of(soup, window));
        var tastes = new TasteProfileService(client, true).compute(chips).tastes();
        assertArrayEquals(soup, tastes.get(0).vector());
        assertNull(tastes.get(1).vector());
        assertNull(tastes.get(2).vector());
        assertArrayEquals(window, tastes.get(3).vector());
        assertEquals(chips.tastes(), tastes.stream().map(StoredTasteChip::chip).toList());
    }
    @Test @DisplayName("칩 벡터_임베딩 실패_벡터 없이 저장하고 features는 유지")
    void compute_vectorFailure_keepsChipsWithoutVectors(org.springframework.boot.test.system.CapturedOutput output) {
        var features = List.of(new TasteFeature("QUIET", "axis", true, 1));
        when(client.profile(chips)).thenReturn(features);
        when(client.vectors(any())).thenThrow(new IllegalStateException("국물"));
        var profile = new TasteProfileService(client, true).compute(chips);
        assertEquals(features, profile.features());
        assertTrue(profile.tastes().stream().allMatch(chip -> chip.vector() == null));
        assertFalse(output.getAll().contains("국물"));
        assertTrue(output.getAll().contains("taste_vectors_failed"));
    }
}
