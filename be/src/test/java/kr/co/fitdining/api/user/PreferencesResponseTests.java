package kr.co.fitdining.api.user;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

class PreferencesResponseTests {
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void preferences_arraysAndNull_keepJsonShape(boolean absent) {
        var service = mock(UserService.class);
        var preferences = mock(UserPreferences.class);
        when(service.preferences("user", null)).thenReturn(preferences);
        when(preferences.getPriorities()).thenReturn(absent ? null : new String[]{"SPACIOUS", "COZY"});
        when(preferences.getPurposes()).thenReturn(absent ? null : new String[]{"SOLO"});
        when(preferences.getTastes()).thenReturn(List.of());

        var response = new UserController(service).preferences("user", null);
        var json = JsonMapper.builder().build().valueToTree(response);
        if (absent) {
            assertNull(response.priorities());
            assertNull(response.purposes());
            assertTrue(json.get("priorities").isNull());
            assertTrue(json.get("purposes").isNull());
        } else {
            assertEquals(List.of("SPACIOUS", "COZY"), response.priorities());
            assertEquals(List.of("SOLO"), response.purposes());
            assertEquals("[\"SPACIOUS\",\"COZY\"]", json.get("priorities").toString());
            assertEquals("[\"SOLO\"]", json.get("purposes").toString());
        }
    }

    @Test
    void preferences_nullArrayElements_keepJsonShape() {
        var service = mock(UserService.class);
        var preferences = mock(UserPreferences.class);
        when(service.preferences("user", null)).thenReturn(preferences);
        when(preferences.getPriorities()).thenReturn(new String[]{"COZY", null});
        when(preferences.getPurposes()).thenReturn(new String[]{"SOLO", null});
        when(preferences.getTastes()).thenReturn(List.of());

        var response = assertDoesNotThrow(() -> new UserController(service).preferences("user", null));
        var json = JsonMapper.builder().build().valueToTree(response);
        assertEquals("[\"COZY\",null]", json.get("priorities").toString());
        assertEquals("[\"SOLO\",null]", json.get("purposes").toString());
        assertThrows(UnsupportedOperationException.class, () -> response.priorities().add("VALUE"));
        assertThrows(UnsupportedOperationException.class, () -> response.purposes().add("DATE"));
    }

}
