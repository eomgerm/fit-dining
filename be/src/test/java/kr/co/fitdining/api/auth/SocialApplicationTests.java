package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.AuthFailure;
import kr.co.fitdining.api.auth.domain.SignupConflict;
import kr.co.fitdining.api.auth.infrastructure.SocialTokens;
import kr.co.fitdining.api.auth.ports.AuthUseCases;
import kr.co.fitdining.api.auth.repository.AuthUserRepository;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

@AutoConfigureMockMvc
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "place.mock.enabled=true"
})
class SocialApplicationTests extends PostgresTestSupport {
    @Autowired SocialAccounts accounts;
    @Autowired AuthUseCases auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired SocialTokens tokens;
    @MockitoSpyBean
    AuthUserRepository users;
    @Test
    @DisplayName("소셜계정_동시 가입_한 계정 생성 후 각각 로그인")
    void signup_concurrentIdentity_createsOneAccount() throws Exception {
        String subject = UUID.randomUUID().toString();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var gate = new CountDownLatch(1);
            var tasks = new ArrayList<Future<AuthUseCases.Issued>>();
            for (int i = 0; i < 4; i++) {
                final int n = i;
                tasks.add(executor.submit(() -> {
                    gate.await();
                    return accounts.signup("google", subject, "동시" + n);
                }));
            }

            gate.countDown();
            var identities = new HashSet<String>();
            for (var task : tasks) identities.add(task.get(20, TimeUnit.SECONDS).identity().userId());
            assertEquals(1, identities.size());
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_social_accounts where provider_user_id=?", Integer.class, subject));
        }
    }

    @Test
    @DisplayName("소셜계정_가입과 갱신 및 로그아웃_이메일 없이 기존 세션 사용")
    void socialSession_refreshLogoutAndProfile_worksWithoutEmail() {
        String subject = UUID.randomUUID().toString();
        var session = accounts.signup("kakao", subject, "소셜검증");
        assertNull(auth.me(session.identity().userId()).email());
        assertEquals(session.identity().userId(), accounts.signup("kakao", subject, "무시닉네임").identity().userId());
        var rotated = auth.refresh(session.refreshToken());
        assertEquals(session.identity().userId(), rotated.identity().userId());
        auth.logout(rotated.refreshToken());
        assertThrows(AuthFailure.class, () -> auth.refresh(rotated.refreshToken()));
    }

    @Test
    @DisplayName("소셜가입_중복 닉네임_이메일 가입과 같은 충돌")
    void signup_duplicateNickname_rejects() {
        accounts.signup("naver", UUID.randomUUID().toString(), "중복확인");
        assertThrows(SignupConflict.class, () -> accounts.signup("google", UUID.randomUUID().toString(), "중복확인"));
    }

    @Test
    @DisplayName("마이그레이션_이메일과 암호 한쪽만 없음_CHECK 거부")
    void migration_halfCredentials_rejects() {
        var session = accounts.signup("naver", UUID.randomUUID().toString(), "제약확인");
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update auth_users set email='half@example.com' where id=?", session.identity().userId()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update auth_users set password_hash='half' where id=?", session.identity().userId()));
    }

    @Test
    @DisplayName("별도계정_같은 제공자 식별자와 이메일 문자열_이메일 계정에 연결 안 함")
    void signup_emailShapedIdentity_remainsIndependent() {
        var email = auth.signup("independent@example.com", "password123", "이메일독립", "independent-address");
        var social = accounts.signup("google", "independent@example.com", "소셜독립");
        assertNotEquals(email.identity().userId(), social.identity().userId());
        assertNull(auth.me(social.identity().userId()).email());
        assertEquals(email.identity().userId(), auth.login("independent@example.com", "password123", "independent-address").identity().userId());
    }

    @Test
    @DisplayName("소셜가입_다른 식별자가 같은 닉네임으로 동시 가입_201 하나와 409 하나")
    void signup_concurrentNickname_returnsOneCreatedAndOneConflict() throws Exception {
        String nickname = "경합" + UUID.randomUUID().toString().substring(0, 8);
        var checked = new CountDownLatch(2);
        var checks = new AtomicInteger();
        Mockito.doAnswer(invocation -> {
            if (checks.incrementAndGet() <= 2) {
                checked.countDown();
                assertTrue(checked.await(10, TimeUnit.SECONDS));
                // Both requests pass the pre-check so the unique index, rather than a sequential check, resolves the race.
                return false;
            }

            return jdbc.queryForObject("select exists(select 1 from auth_users where lower(nickname)=lower(?))",
                    Boolean.class, nickname);
        }).when(users).existsByNickname(nickname);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks = new ArrayList<Future<Integer>>();
            for (int i = 0; i < 2; i++) {
                String subject = UUID.randomUUID().toString();
                tasks.add(executor.submit(() -> mvc.perform(
                    MockMvcRequestBuilders.post("/api/auth/social/signup")
                    .header("Origin", "http://localhost:3000").contentType("application/json")
                    .content("{\"nickname\":\"" + nickname + "\",\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}")
                    .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", subject))))
                    .andReturn().getResponse().getStatus()));
            }

            var statuses = new ArrayList<Integer>();
            for (var task : tasks) statuses.add(task.get(20, TimeUnit.SECONDS));
            statuses.sort(Integer::compareTo);
            assertEquals(List.of(201, 409), statuses);
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_users where nickname=?", Integer.class, nickname));
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_social_accounts a join auth_users u on a.user_id=u.id where u.nickname=?", Integer.class, nickname));
            assertEquals(3, checks.get());
        }
    }
}
