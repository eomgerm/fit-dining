package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import kr.co.fitdining.api.user.*;
import kr.co.fitdining.api.user.Preferences.Polarity;
import kr.co.fitdining.api.user.Preferences.TasteChip;
import org.junit.jupiter.api.Test;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
class TasteProfileServiceTests {
    final AiTasteClient client = mock(AiTasteClient.class);
    final Preferences chips = new Preferences(Preferences.Mood.QUIET, null, null, List.of(
            new TasteChip(Polarity.LIKE, "국물", null),
            new TasteChip(Polarity.LIKE, "조용한", "QUIET")));

    @Test void disabledOrMissingPreferences_neverCallsAi() {
        var disabled = new TasteProfileService(client, false).compute(chips);
        assertEquals(List.of(), disabled.features());
        assertEquals(chips.tastes(), disabled.tastes().stream().map(StoredTasteChip::chip).toList());
        assertTrue(disabled.tastes().stream().allMatch(chip -> chip.vector() == null));
        assertEquals(new TasteProfileService.Profile(List.of(), List.of()), new TasteProfileService(client, true).compute(null));
        verifyNoInteractions(client);
    }
    @Test void success_returnsAiProfile() {
        var profile = new TasteProfileService.Profile(List.of(new TasteFeature("QUIET", "axis", true, 1)),
                List.of(StoredTasteChip.of(chips.tastes().getFirst(), new float[] {0.1f})));
        when(client.profile(chips)).thenReturn(profile);
        assertSame(profile, new TasteProfileService(client, true).compute(chips));
    }
    @Test void failure_keepsChipsWithoutVectorsAndPayloadLogs(org.springframework.boot.test.system.CapturedOutput output) {
        when(client.profile(chips)).thenThrow(new IllegalStateException("국물"));
        var profile = new TasteProfileService(client, true).compute(chips);
        assertEquals(List.of(), profile.features());
        assertEquals(chips.tastes(), profile.tastes().stream().map(StoredTasteChip::chip).toList());
        assertTrue(profile.tastes().stream().allMatch(chip -> chip.vector() == null));
        assertFalse(output.getAll().contains("국물"));
        assertTrue(output.getAll().contains("IllegalStateException"));
    }
}
