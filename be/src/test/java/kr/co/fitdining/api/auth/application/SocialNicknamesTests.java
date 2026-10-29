package kr.co.fitdining.api.auth.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.random.RandomGenerator;
import kr.co.fitdining.api.auth.presentation.SignupValue;
import kr.co.fitdining.api.auth.domain.SignupConflict;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

class SocialNicknamesTests {
    @Test void allCombinations_obeyNicknameRules() {
        var random = mock(RandomGenerator.class);
        var names = new SocialNicknames(random);
        assertEquals(24, SocialNicknames.ACTIONS.size());
        assertEquals(32, SocialNicknames.CHARACTERS.size());
        for (int a = 0; a < 24; a++) for (int c = 0; c < 32; c++) {
            when(random.nextInt(24)).thenReturn(a);
            when(random.nextInt(32)).thenReturn(c);
            String base = SocialNicknames.ACTIONS.get(a) + "하는 " + SocialNicknames.CHARACTERS.get(c);
            for (int attempt = 0; attempt < 10; attempt++) {
                for (int suffix : new int[]{1000, 9999}) {
                    when(random.nextInt(1000, 10000)).thenReturn(suffix);
                    String name = names.next(attempt);
                    assertEquals(base + (attempt < 5 ? "" : suffix), name);
                    assertTrue(SignupValue.Validator.valid("nickname", name));
                    assertTrue(name.matches("^.+하는 .+$"));
                }
            }
        }
    }

    @Test void conflicts_retryBothPrecheckAndUniqueRace() {
        var tx = mock(SocialAccountTransactions.class);
        var users = mock(AuthUserRepository.class);
        var names = mock(SocialNicknames.class);
        var accounts = new SocialAccounts(tx, users, names);
        when(names.next(0)).thenReturn("first");
        when(names.next(1)).thenReturn("second");
        when(names.next(2)).thenReturn("third");
        when(tx.signup("google", "id", "first", null)).thenThrow(new SignupConflict("nickname"));
        when(tx.signup("google", "id", "second", null)).thenThrow(new DataIntegrityViolationException("race"));
        when(users.existsByNickname("second")).thenReturn(true);
        accounts.signup("google", "id");
        verify(tx).signup("google", "id", "third", null);
    }

    @Test void exhaustedRetries_areGeneralError() {
        var tx = mock(SocialAccountTransactions.class);
        var names = mock(SocialNicknames.class);
        when(names.next(anyInt())).thenReturn("name");
        when(tx.signup(anyString(), anyString(), anyString(), isNull())).thenThrow(new SignupConflict("nickname"));
        var accounts = new SocialAccounts(tx, mock(AuthUserRepository.class), names);
        assertThrows(IllegalStateException.class, () -> accounts.signup("google", "id"));
        verify(names).next(9);
        verify(tx, times(10)).signup("google", "id", "name", null);
    }

    @Test void unrelatedConflicts_areNotRetried() {
        var tx = mock(SocialAccountTransactions.class);
        var names = mock(SocialNicknames.class);
        when(names.next(0)).thenReturn("name");
        var accounts = new SocialAccounts(tx, mock(AuthUserRepository.class), names);
        when(tx.signup("google", "id", "name", null)).thenThrow(new DataIntegrityViolationException("other"));
        assertThrows(DataIntegrityViolationException.class, () -> accounts.signup("google", "id"));
        verify(names, never()).next(1);
    }
}
