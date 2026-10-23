package kr.co.fitdining.api.ops;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

/**
 * 배포 전환 때 처리 중인 요청을 마치고 내려가는 종료 설정(BE 계약 #4)을 검증한다.
 * 종료 동작은 SIGTERM이 있어야 확인되므로 설정 파일의 값만 본다.
 */
class ShutdownSettingsTest {

	private String applicationYml(String key) throws IOException {
		PropertySource<?> yml = new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml")).get(0);
		return String.valueOf(yml.getProperty(key));
	}

	@Test
	@DisplayName("종료_application.yml에서_graceful이다")
	void shutdown_applicationYml_isGraceful() throws IOException {
		assertThat(applicationYml("server.shutdown")).isEqualTo("graceful");
	}

	@Test
	@DisplayName("종료대기_application.yml에서_30초이다")
	void shutdownTimeout_applicationYml_is30Seconds() throws IOException {
		// compose의 stop_grace_period(40s)보다 짧아야 한다
		assertThat(applicationYml("spring.lifecycle.timeout-per-shutdown-phase")).isEqualTo("30s");
	}

}
