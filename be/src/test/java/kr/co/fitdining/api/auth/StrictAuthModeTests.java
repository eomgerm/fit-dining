package kr.co.fitdining.api.auth;

import static org.junit.jupiter.api.Assertions.*;
import kr.co.fitdining.api.auth.infrastructure.*;
import kr.co.fitdining.api.auth.ports.AuthPolicy;
import kr.co.fitdining.api.auth.presentation.DevAuthController;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class StrictAuthModeTests extends PostgresTestSupport {
    @Autowired ApplicationContext context;
    @Test @DisplayName("기본 모드_빈 등록_Strict만 존재하고 개발 API 없음")
    void beans_default_onlyStrictWithoutDevController() {
        assertEquals(1, context.getBeansOfType(AuthPolicy.class).size());
        assertInstanceOf(StrictAuthPolicy.class, context.getBean(AuthPolicy.class));
        assertTrue(context.getBeansOfType(SimpleAuthPolicy.class).isEmpty());
        assertTrue(context.getBeansOfType(DevAuthController.class).isEmpty());
    }
}
