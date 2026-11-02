package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import kr.co.fitdining.api.auth.domain.AuthText;
import kr.co.fitdining.api.auth.presentation.SignupRequest;
import kr.co.fitdining.api.auth.presentation.SignupValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class AuthTextTests {
    @ParameterizedTest @ValueSource(strings = {"\u00a0", "\u3000", "\u202f", "\ufeff", "\t\n "})
    @DisplayName("정규화_유니코드 바깥 공백_이메일과 닉네임에서 제거")
    void normalize_unicodeWhitespace_stripsBothFields(String space) {
        var request = new SignupRequest(space + " User@Example.com" + space, "password1", space + " 새이름" + space, null);
        assertEquals("user@example.com", request.email());
        assertEquals("새이름", request.nickname());
        assertTrue(SignupValue.Validator.valid("email", request.email()));
        assertTrue(SignupValue.Validator.valid("nickname", request.nickname()));
    }

    @ParameterizedTest @ValueSource(strings = {"새\t이름", "새\n이름", "새\u0000이름", "새\u0085이름"})
    @DisplayName("닉네임_내부 제어 문자_거부")
    void nickname_internalControl_rejected(String nickname) {
        assertFalse(SignupValue.Validator.valid("nickname", nickname));
    }

    @ParameterizedTest @ValueSource(strings = {"a\u00a0b@example.com", "a@exam\u3000ple.com"})
    @DisplayName("이메일_내부 유니코드 공백_거부")
    void email_internalWhitespace_rejected(String email) {
        assertFalse(SignupValue.Validator.valid("email", email));
    }

    @Test @DisplayName("정규화_누락 입력_null 유지")
    void normalize_omittedInput_keepsNull() { assertNull(AuthText.strip(null)); }

    @Test
    void email_maximumLength_accepts254Rejects255() {
        String email = "a".repeat(242) + "@example.com";
        assertTrue(SignupValue.Validator.valid("email", email));
        assertFalse(SignupValue.Validator.valid("email", "a" + email));
    }

    @ParameterizedTest @ValueSource(strings = {"ascii", "multibyte"})
    void password_maximumBytes_accepts72Rejects73(String kind) {
        String password = kind.equals("ascii") ? "a1" + "a".repeat(70) : "abc123" + "\uac00".repeat(22);
        assertEquals(72, password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
        assertTrue(SignupValue.Validator.valid("password", password));
        assertFalse(SignupValue.Validator.valid("password", password + "a"));
    }

    @ParameterizedTest @ValueSource(strings = {"a", "\uac00", "\ud83d\ude00"})
    void nickname_maximumCodePoints_accepts15Rejects16(String character) {
        String nickname = character.repeat(15);
        assertTrue(SignupValue.Validator.valid("nickname", nickname));
        assertFalse(SignupValue.Validator.valid("nickname", nickname + character));
        var request = new SignupRequest("user@example.com", "password1", " " + nickname + " ", null);
        assertEquals(nickname, request.nickname());
        assertTrue(SignupValue.Validator.valid("nickname", request.nickname()));
    }
}
