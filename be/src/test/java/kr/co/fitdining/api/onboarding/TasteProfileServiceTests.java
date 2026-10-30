package kr.co.fitdining.api.onboarding;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import kr.co.fitdining.api.user.*;
import org.junit.jupiter.api.Test;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
class TasteProfileServiceTests {
    final AiTasteClient client = mock(AiTasteClient.class);
    final Preferences answers = new Preferences(Preferences.Mood.QUIET, null, null, null);
    @Test void disabledOrMissingPreferences_neverCallsAi() {
        assertEquals(List.of(), new TasteProfileService(client, false).compute(answers));
        assertEquals(List.of(), new TasteProfileService(client, true).compute(null));
        verifyNoInteractions(client);
    }
    @Test void success_returnsFeatures() {
        var features = List.of(new TasteFeature("QUIET", "axis", true, 1));
        when(client.profile(answers)).thenReturn(features);
        assertEquals(features, new TasteProfileService(client, true).compute(answers));
        verify(client).profile(answers);
    }
    @Test void failure_hasEmptyFallbackWithoutPayloadLogs(org.springframework.boot.test.system.CapturedOutput output) {
        when(client.profile(answers)).thenThrow(new IllegalStateException("sensitive payload"));
        assertEquals(List.of(), new TasteProfileService(client, true).compute(answers));
        assertFalse(output.getAll().contains("sensitive payload"));
        assertTrue(output.getAll().contains("IllegalStateException"));
    }
}
