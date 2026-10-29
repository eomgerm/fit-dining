package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import kr.co.fitdining.api.auth.application.*;
import kr.co.fitdining.api.auth.domain.AuthFailure;
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
    @MockitoSpyBean SocialNicknames nicknames;

    @Test
    void signup_duplicateNickname_retriesAfterRollback() {
        String taken = "충돌" + UUID.randomUUID().toString().substring(0, 8);
        String available = "신규" + UUID.randomUUID().toString().substring(0, 8);
        auth.signup(UUID.randomUUID() + "@example.com", "password123", taken, "nickname-retry");
        Mockito.doReturn(taken).when(nicknames).next(0);
        Mockito.doReturn(available).when(nicknames).next(1);
        var issued = accounts.signup("google", UUID.randomUUID().toString());
        assertEquals(available, issued.identity().nickname());
        Mockito.verify(nicknames).next(1);
    }

    @Test
    @DisplayName("소셜계정_동시 가입_한 계정 생성 후 각각 로그인")
    void signup_concurrentIdentity_createsOneAccount() throws Exception {
        String subject = UUID.randomUUID().toString();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var gate = new CountDownLatch(1);
            var tasks = new ArrayList<Future<AuthUseCases.Issued>>();
            for (int i = 0; i < 4; i++) {
                tasks.add(executor.submit(() -> {
                    gate.await();
                    return accounts.signup("google", subject);
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
        var session = accounts.signup("kakao", subject);
        assertNull(auth.me(session.identity().userId()).email());
        assertEquals(session.identity().userId(), accounts.signup("kakao", subject).identity().userId());
        var rotated = auth.refresh(session.refreshToken());
        assertEquals(session.identity().userId(), rotated.identity().userId());
        auth.logout(rotated.refreshToken());
        assertThrows(AuthFailure.class, () -> auth.refresh(rotated.refreshToken()));
    }

    @Test
    @DisplayName("마이그레이션_이메일과 암호 한쪽만 없음_CHECK 거부")
    void migration_halfCredentials_rejects() {
        var session = accounts.signup("naver", UUID.randomUUID().toString());
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update auth_users set email='half@example.com' where id=?", session.identity().userId()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update("update auth_users set password_hash='half' where id=?", session.identity().userId()));
    }

    @Test
    @DisplayName("별도계정_같은 제공자 식별자와 이메일 문자열_이메일 계정에 연결 안 함")
    void signup_emailShapedIdentity_remainsIndependent() {
        var email = auth.signup("independent@example.com", "password123", "이메일독립", "independent-address");
        var social = accounts.signup("google", "independent@example.com");
        assertNotEquals(email.identity().userId(), social.identity().userId());
        assertNull(auth.me(social.identity().userId()).email());
        assertEquals(email.identity().userId(), auth.login("independent@example.com", "password123", "independent-address").identity().userId());
    }

    @Test
    @DisplayName("소셜가입_닉네임 유일 인덱스 경합_재시도로 둘 다 가입")
    void signup_concurrentNickname_retriesInFreshTransaction() throws Exception {
        String nickname = "경합" + UUID.randomUUID().toString().substring(0, 8);
        Mockito.doReturn(nickname).when(nicknames).next(0);
        var checked = new CountDownLatch(2);
        var checks = new AtomicInteger();
        Mockito.doAnswer(invocation -> {
            if (checks.incrementAndGet() <= 2) {
                checked.countDown();
                assertTrue(checked.await(10, TimeUnit.SECONDS));
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
                    .content("{\"agreements\":{\"ageOver14\":true,\"terms\":true,\"privacy\":true}}")
                    .cookie(new Cookie("fitdining_social", tokens.encode("social_signup", "google", subject))))
                    .andReturn().getResponse().getStatus()));
            }
            for (var task : tasks) assertEquals(201, task.get(20, TimeUnit.SECONDS));
            assertEquals(1, jdbc.queryForObject("select count(*) from auth_users where nickname=?", Integer.class, nickname));
            assertEquals(3, checks.get());
            Mockito.verify(nicknames).next(1);
        }
    }

}
