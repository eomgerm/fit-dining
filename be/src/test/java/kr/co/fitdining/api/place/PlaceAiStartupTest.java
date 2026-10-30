package kr.co.fitdining.api.place;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * AI 주소가 비었거나 닿지 않아도 DB 모드 웹 앱이 뜨고 readiness는 DB만 보며, 검색은 대체로 응답한다(place-ai-search
 * AC-14). 관리 경로는 {@code ManagementEndpointsTest}처럼 MockMvc로 보려고 같은 포트에 둔다. 컨텍스트마다 Hikari 연결을
 * 잡아 두므로 풀을 작게 둔다.
 */
@DisplayName("AI 없이 기동")
class PlaceAiStartupTest {

	static final String COMMON = "management.server.port=8080";

	abstract static class Startup extends PostgresTestSupport {

		@Autowired
		MockMvc mockMvc;

		@Test
		@DisplayName("기동_AI가없어도_readiness가UP이고검색은AI_UNAVAILABLE로대체한다")
		void startup_withoutAi_readyAndFallsBack() throws Exception {
			mockMvc.perform(get("/actuator/health/readiness"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.status").value("UP"));
			mockMvc.perform(post("/api/v1/places/search").contentType(MediaType.APPLICATION_JSON)
							.content("{\"query\":\"근처 맛집\"}"))
					.andExpect(status().isOk())
					.andExpect(header().string("X-Fallback", "AI_UNAVAILABLE"));
		}
	}

	@Nested
	@DisplayName("주소가 빈 값")
	@SpringBootTest(properties = {COMMON, "place.mock.enabled=false", "fitdining.ai.base-url=",
			"spring.datasource.hikari.maximum-pool-size=2"})
	@AutoConfigureMockMvc
	class BlankBaseUrl extends Startup {
	}

	@Nested
	@DisplayName("닿지 않는 주소")
	@SpringBootTest(properties = {COMMON, "place.mock.enabled=false", "fitdining.ai.base-url=http://127.0.0.1:1",
			"spring.datasource.hikari.maximum-pool-size=2"})
	@AutoConfigureMockMvc
	class UnreachableBaseUrl extends Startup {
	}

}
