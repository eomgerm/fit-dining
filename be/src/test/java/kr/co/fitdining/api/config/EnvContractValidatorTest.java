package kr.co.fitdining.api.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kr.co.fitdining.api.ApiApplication;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;

class EnvContractValidatorTest {

	/** 서버 dev.env와 같은 모양의 정상 값 */
	private static Map<String, String> devEnv() {
		Map<String, String> env = new HashMap<>();
		env.put("APP_ENV", "dev");
		env.put("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/fit_dev");
		env.put("SPRING_DATASOURCE_USERNAME", "fit_dev_app");
		env.put("SPRING_DATASOURCE_PASSWORD", "secret-value");
		env.put("SPRING_DATA_REDIS_HOST", "redis-dev");
		env.put("OPENSEARCH_INDEX_PREFIX", "dev-");
		env.put("PLACE_MOCK_ENABLED", "true");
		return env;
	}

	private static Map<String, String> prodEnv() {
		Map<String, String> env = devEnv();
		env.put("APP_ENV", "prod");
		env.put("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/fit_prod");
		env.put("SPRING_DATASOURCE_USERNAME", "fit_prod_app");
		env.put("SPRING_DATA_REDIS_HOST", "redis-prod");
		env.put("OPENSEARCH_INDEX_PREFIX", "prod-");
		env.remove("PLACE_MOCK_ENABLED");
		return env;
	}

	private static List<String> validate(Map<String, String> env, String... profiles) {
		return EnvContractValidator.validate(env::get, Set.of(profiles));
	}

	@Nested
	@DisplayName("통과")
	class Pass {

		@Test
		@DisplayName("검증_APP_ENV도서버프로필도없으면_로컬로보고검사하지않는다")
		void validate_local_skips() {
			assertThat(validate(Map.of())).isEmpty();
		}

		@Test
		@DisplayName("검증_dev값이모두맞으면_위반이없다")
		void validate_validDev_noViolation() {
			assertThat(validate(devEnv(), "dev")).isEmpty();
		}

		@Test
		@DisplayName("검증_prod값이모두맞으면_위반이없다")
		void validate_validProd_noViolation() {
			assertThat(validate(prodEnv(), "prod")).isEmpty();
		}

		@Test
		@DisplayName("검증_마이그레이션컨테이너는_DDL계정이어도통과한다")
		void validate_migrateProfile_noViolation() {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATASOURCE_USERNAME", "fit_migrator");
			env.remove("SPRING_DATA_REDIS_HOST");
			env.remove("OPENSEARCH_INDEX_PREFIX");

			assertThat(validate(env, "migrate")).isEmpty();
		}

		@Test
		@DisplayName("검증_아직쓰지않는Redis와OpenSearch키가없어도_통과한다")
		void validate_noRedisAndOpenSearch_noViolation() {
			Map<String, String> env = devEnv();
			env.remove("SPRING_DATA_REDIS_HOST");
			env.remove("OPENSEARCH_INDEX_PREFIX");

			assertThat(validate(env, "dev")).isEmpty();
		}

		@Test
		@DisplayName("검증_JDBC URL에쿼리가붙어도_DB이름을맞춰본다")
		void validate_urlWithQuery_noViolation() {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/fit_dev?ssl=false");

			assertThat(validate(env, "dev")).isEmpty();
		}

	}

	@Nested
	@DisplayName("거부")
	class Reject {

		@Test
		@DisplayName("검증_서버프로필인데APP_ENV가없으면_거부한다")
		void validate_serverProfileWithoutAppEnv_rejects() {
			Map<String, String> env = devEnv();
			env.remove("APP_ENV");

			assertThat(validate(env, "dev")).singleElement().asString().contains("APP_ENV");
		}

		@Test
		@DisplayName("검증_APP_ENV가dev나prod가아니면_거부한다")
		void validate_unknownAppEnv_rejects() {
			Map<String, String> env = devEnv();
			env.put("APP_ENV", "staging");

			assertThat(validate(env, "dev")).singleElement().asString().contains("staging");
		}

		@ParameterizedTest
		@ValueSource(strings = {"", " ", "REPLACE_ME"})
		@DisplayName("검증_필수값이비었거나REPLACE_ME면_거부한다")
		void validate_blankOrPlaceholder_rejects(String value) {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATASOURCE_PASSWORD", value);

			assertThat(validate(env, "dev")).singleElement().asString().contains("SPRING_DATASOURCE_PASSWORD");
		}

		@Test
		@DisplayName("검증_필수값이없으면_거부한다")
		void validate_requiredKeyAbsent_rejects() {
			Map<String, String> env = devEnv();
			env.remove("SPRING_DATASOURCE_USERNAME");

			assertThat(validate(env, "dev")).singleElement().asString().contains("SPRING_DATASOURCE_USERNAME");
		}

		@Test
		@DisplayName("검증_dev가prod DB를가리키면_거부한다")
		void validate_devPointsToProdDb_rejects() {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/fit_prod");

			assertThat(validate(env, "dev")).singleElement().asString().contains("fit_prod").contains("fit_dev");
		}

		@Test
		@DisplayName("검증_dev가prod Redis를가리키면_거부한다")
		void validate_devPointsToProdRedis_rejects() {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATA_REDIS_HOST", "redis-prod");

			assertThat(validate(env, "dev")).singleElement().asString().contains("SPRING_DATA_REDIS_HOST");
		}

		@Test
		@DisplayName("검증_dev가prod인덱스접두사를쓰면_거부한다")
		void validate_devUsesProdIndexPrefix_rejects() {
			Map<String, String> env = devEnv();
			env.put("OPENSEARCH_INDEX_PREFIX", "prod-");

			assertThat(validate(env, "dev")).singleElement().asString().contains("OPENSEARCH_INDEX_PREFIX");
		}

		@Test
		@DisplayName("검증_프로필과APP_ENV가다르면_거부한다")
		void validate_profileMismatch_rejects() {
			assertThat(validate(devEnv(), "prod")).singleElement().asString().contains("prod").contains("dev");
		}

		@ParameterizedTest
		@ValueSource(strings = {"true", "TRUE", "on", "yes", "1"})
		@DisplayName("검증_prod에서Mock스위치를켜면_거부한다")
		void validate_prodWithMockEnabled_rejects(String value) {
			Map<String, String> env = prodEnv();
			env.put("REVIEW_MOCK_ENABLED", value);

			assertThat(validate(env, "prod")).singleElement().asString().contains("REVIEW_MOCK_ENABLED");
		}

		@Test
		@DisplayName("검증_위반메시지에_비밀값을넣지않는다")
		void validate_violations_doNotLeakSecrets() {
			Map<String, String> env = devEnv();
			env.put("SPRING_DATASOURCE_URL", "jdbc:postgresql://postgres:5432/fit_prod");
			env.put("SPRING_DATASOURCE_USERNAME", "REPLACE_ME");

			assertThat(validate(env, "dev")).hasSize(2).noneMatch(message -> message.contains("secret-value"));
		}

	}

	@Test
	@DisplayName("기동_계약을어기면_DB에접속하기전에기동을거부한다")
	void run_contractViolated_failsBeforeContext() {
		// 등록(spring.factories)까지 확인한다. 존재하지 않는 호스트라 검사를 지나치면 DB 접속에서 다른 예외가 난다.
		SpringApplicationBuilder app = new SpringApplicationBuilder(ApiApplication.class)
				.properties(
						"APP_ENV=dev",
						"SPRING_DATASOURCE_URL=jdbc:postgresql://no-such-host:5432/fit_prod",
						"SPRING_DATASOURCE_USERNAME=fit_dev_app",
						"SPRING_DATASOURCE_PASSWORD=secret-value");

		assertThatThrownBy(() -> app.run())
				.isInstanceOf(IllegalStateException.class)
				.hasMessageContaining("환경변수 계약")
				.hasMessageContaining("fit_prod");
	}

}
