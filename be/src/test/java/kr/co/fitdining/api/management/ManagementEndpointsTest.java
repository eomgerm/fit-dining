package kr.co.fitdining.api.management;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import kr.co.fitdining.api.support.PostgresTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 배포 스크립트와 모니터링이 쓰는 관리 경로(인프라 계약 #1)를 검증한다.
 *
 * <p>배포 스크립트는 새 컨테이너의 {@code /actuator/health/readiness}가 {@code UP}이 될 때까지 기다린 뒤에야 트래픽을 넘긴다.
 * 노출하는 경로는 health(readiness, liveness 포함)와 prometheus뿐이고 상태 응답에는 세부 정보를 담지 않는다.
 * Spring Boot의 시험 환경은 지표 내보내기를 기본으로 꺼 두므로 시험에서만 Prometheus 내보내기를 켠다.
 *
 * <p>이 시험은 서버를 띄우지 않고 MockMvc로 확인한다. 관리 포트가 다르면 MockMvc에서는 관리 경로가 열리지 않으므로 시험에서만
 * 포트를 같게 두고, 운영 값인 8081은 {@code application.yml}을 읽어 따로 확인한다. 일부 Windows PC(WSL의 Hyper-V 방화벽 등)에서는
 * 서버 소켓의 {@code listen}이 무작위로 실패해 실제 서버를 띄우는 시험이 흔들리므로 소켓을 쓰지 않는다. 관리 포트로만 열리는 것은
 * 실제 서버를 띄워 따로 확인한다. readiness가 사용하는 DB는 공통 Testcontainers 기반에서 제공한다.
 */
@SpringBootTest(properties = {"management.server.port=8080", "management.prometheus.metrics.export.enabled=true"})
@AutoConfigureMockMvc
@DisplayName("관리 경로")
class ManagementEndpointsTest extends PostgresTestSupport {

	@Autowired
	private MockMvc mockMvc;

	@Nested
	@DisplayName("상태 확인")
	class Health {

		@Test
		@DisplayName("readiness_요청하면_UP을돌려준다")
		void readiness_request_returnsUp() throws Exception {
			mockMvc.perform(get("/actuator/health/readiness"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.status").value("UP"));
		}

		@Test
		@DisplayName("liveness_요청하면_UP을돌려준다")
		void liveness_request_returnsUp() throws Exception {
			mockMvc.perform(get("/actuator/health/liveness"))
					.andExpect(status().isOk())
					.andExpect(jsonPath("$.status").value("UP"));
		}

		@ParameterizedTest
		@ValueSource(strings = {"/actuator/health", "/actuator/health/readiness", "/actuator/health/liveness"})
		@DisplayName("상태응답_세부정보를_담지않는다")
		void health_response_hasNoDetails(String path) throws Exception {
			mockMvc.perform(get(path))
					.andExpect(jsonPath("$.components").doesNotExist())
					.andExpect(jsonPath("$.details").doesNotExist());
		}
	}

	@Nested
	@DisplayName("지표")
	class Metrics {

		@Test
		@DisplayName("prometheus_요청하면_지표를돌려준다")
		void prometheus_request_returnsMetrics() throws Exception {
			mockMvc.perform(get("/actuator/prometheus"))
					.andExpect(status().isOk())
					.andExpect(content().string(org.hamcrest.Matchers.containsString("jvm_memory_used_bytes")));
		}
	}

	@Nested
	@DisplayName("노출 범위")
	class Exposure {

		@ParameterizedTest
		@ValueSource(strings = {"/actuator/env", "/actuator/beans", "/actuator/info", "/actuator/configprops", "/actuator/heapdump", "/actuator/loggers"})
		@DisplayName("관리경로_health와prometheus밖은_열려있지않다")
		void actuator_otherEndpoints_notFound(String path) throws Exception {
			mockMvc.perform(get(path)).andExpect(status().isNotFound());
		}
	}

	@Nested
	@DisplayName("설정 파일")
	class Settings {

		// 시험은 관리 포트를 같게 두고 돌리므로 운영 값은 파일에서 직접 읽는다
		private String applicationYml(String key) throws IOException {
			PropertySource<?> yml = new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml")).get(0);
			return String.valueOf(yml.getProperty(key));
		}

		@Test
		@DisplayName("관리포트_application.yml에서_8081이다")
		void managementPort_applicationYml_is8081() throws IOException {
			assertThat(applicationYml("management.server.port")).isEqualTo("8081");
		}

		@Test
		@DisplayName("readiness그룹_application.yml에서_DB만본다")
		void readinessGroup_applicationYml_includesOnlyReadinessStateAndDb() throws IOException {
			// 외부 서비스(Modal 등)를 보면 외부 장애가 readiness를 흔들어 재시작 폭풍이 난다
			assertThat(applicationYml("management.endpoint.health.group.readiness.include")).isEqualTo("readinessState,db");
		}

		@Test
		@DisplayName("노출경로_application.yml에서_health와prometheus뿐이다")
		void exposure_applicationYml_isHealthAndPrometheusOnly() throws IOException {
			assertThat(applicationYml("management.endpoints.web.exposure.include")).isEqualTo("health,prometheus");
		}
	}
}
