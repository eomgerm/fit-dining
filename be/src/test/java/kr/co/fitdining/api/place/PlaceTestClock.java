package kr.co.fitdining.api.place;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

/**
 * 2026-10-21(수) 12:00 KST로 고정한 시계. 응답의 영업 상태를 고정한다. {@code PlaceControllerTest}와
 * {@code PlaceAreaSearchControllerTest}가 같은 class를 import해 Spring context 하나를 함께 쓴다.
 */
@TestConfiguration
class PlaceTestClock {

	@Bean
	Clock clock() {
		return Clock.fixed(Instant.parse("2026-10-21T03:00:00Z"), ZoneId.of("Asia/Seoul"));
	}
}
