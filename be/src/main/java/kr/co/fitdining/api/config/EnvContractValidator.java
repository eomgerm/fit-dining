package kr.co.fitdining.api.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;

/**
 * 부팅 때 환경변수 계약(docs/infra/contracts/env.md)을 검사해 어긋나면 기동을 거부한다(docs/infra/design.md 12.1절 #8).
 * dev가 prod 데이터를 건드리지 않게 하는 안전장치라 Bean(DataSource)을 만들기 전에 돈다.
 * {@code META-INF/spring.factories}로 등록한다.
 *
 * <p>{@code APP_ENV}가 없고 서버 프로필(dev, prod, migrate)도 아니면 로컬 개발로 보고 검사하지 않는다.
 * 지금 BE가 쓰는 키만 필수로 둔다. Redis와 OpenSearch 키는 아직 쓰지 않아 값이 있을 때만 맞춰 본다.
 */
public class EnvContractValidator implements EnvironmentPostProcessor, Ordered {

	static final String PLACEHOLDER = "REPLACE_ME";

	private static final Set<String> APP_ENVS = Set.of("dev", "prod");
	private static final Set<String> SERVER_PROFILES = Set.of("dev", "prod", "migrate");
	private static final List<String> REQUIRED = List.of(
			"SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD");
	private static final List<String> MOCK_SWITCHES = List.of("PLACE_MOCK_ENABLED", "REVIEW_MOCK_ENABLED");
	// Spring이 true로 읽는 값(StringToBooleanConverter)
	private static final Set<String> TRUE_VALUES = Set.of("true", "on", "yes", "1");

	@Override
	public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
		List<String> violations = validate(environment::getProperty, Set.of(environment.getActiveProfiles()));
		if (!violations.isEmpty()) {
			throw new IllegalStateException("환경변수 계약(docs/infra/contracts/env.md)을 어겨 기동을 거부한다:\n- "
					+ String.join("\n- ", violations));
		}
	}

	/** 설정 파일(.env 포함)을 읽은 뒤에 돈다. */
	@Override
	public int getOrder() {
		return Ordered.LOWEST_PRECEDENCE;
	}

	/**
	 * 계약 위반 목록을 돌려준다. 메시지에 비밀 값을 넣지 않는다.
	 *
	 * @param env 키로 값을 찾는 함수. 없으면 null을 돌려준다.
	 * @param activeProfiles 활성 프로필
	 * @return 위반 목록. 없으면 빈 목록
	 */
	static List<String> validate(Function<String, String> env, Set<String> activeProfiles) {
		String appEnv = env.apply("APP_ENV");
		if (appEnv == null && activeProfiles.stream().noneMatch(SERVER_PROFILES::contains)) {
			return List.of();
		}
		if (isMissing(appEnv)) {
			return List.of("APP_ENV 값이 없거나 " + PLACEHOLDER + "다");
		}
		if (!APP_ENVS.contains(appEnv)) {
			return List.of("APP_ENV는 dev 또는 prod여야 한다: " + appEnv);
		}

		List<String> violations = new ArrayList<>();
		activeProfiles.stream()
				.filter(APP_ENVS::contains)
				.filter(profile -> !profile.equals(appEnv))
				.forEach(profile -> violations.add("프로필 " + profile + "이 APP_ENV(" + appEnv + ")와 다르다"));

		for (String key : REQUIRED) {
			if (isMissing(env.apply(key))) {
				violations.add(key + " 값이 없거나 " + PLACEHOLDER + "다");
			}
		}

		String url = env.apply("SPRING_DATASOURCE_URL");
		if (!isMissing(url)) {
			expect(violations, "SPRING_DATASOURCE_URL의 DB", databaseName(url), "fit_" + appEnv);
		}
		String redisHost = env.apply("SPRING_DATA_REDIS_HOST");
		if (redisHost != null) {
			expect(violations, "SPRING_DATA_REDIS_HOST", redisHost, "redis-" + appEnv);
		}
		String indexPrefix = env.apply("OPENSEARCH_INDEX_PREFIX");
		if (indexPrefix != null) {
			expect(violations, "OPENSEARCH_INDEX_PREFIX", indexPrefix, appEnv + "-");
		}

		if (appEnv.equals("prod")) {
			for (String key : MOCK_SWITCHES) {
				String value = env.apply(key);
				if (value != null && TRUE_VALUES.contains(value.trim().toLowerCase())) {
					violations.add(key + "는 prod에서 켤 수 없다");
				}
			}
		}
		return violations;
	}

	/** {@code jdbc:postgresql://host:5432/fit_dev?ssl=true}에서 {@code fit_dev}를 꺼낸다. */
	static String databaseName(String jdbcUrl) {
		String path = jdbcUrl.split("\\?", 2)[0];
		return path.substring(Math.max(path.lastIndexOf('/'), path.lastIndexOf(':')) + 1);
	}

	private static boolean isMissing(String value) {
		return value == null || value.isBlank() || value.equals(PLACEHOLDER);
	}

	private static void expect(List<String> violations, String name, String actual, String expected) {
		if (!actual.equals(expected)) {
			violations.add(name + "(" + actual + ")가 APP_ENV와 맞지 않는다. " + expected + "여야 한다");
		}
	}

}
