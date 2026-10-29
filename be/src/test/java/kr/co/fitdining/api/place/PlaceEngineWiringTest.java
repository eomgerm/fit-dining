package kr.co.fitdining.api.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import kr.co.fitdining.api.place.catalog.PlaceCatalog;
import kr.co.fitdining.api.place.engine.CatalogPlaceSearchEngine;
import kr.co.fitdining.api.place.engine.MockPlaceSearchEngine;
import kr.co.fitdining.api.place.engine.PlaceSearchEngine;
import kr.co.fitdining.api.place.keyword.PlaceKeywordSearch;
import org.junit.jupiter.api.DisplayName;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

/**
 * 스위치({@code place.mock.enabled})에 따라 엔진 빈이 환경마다 정확히 하나인지, DB 모드 빈은 Mock이 꺼졌을 때만
 * 등록되는지 본다(place-lookup-db AC-20, AC-22). DB도 전체 컨텍스트도 띄우지 않는다. 전체 컨텍스트는 Hikari 연결을
 * 10개씩 잡은 채 JVM이 끝날 때까지 캐시돼, 공유 Postgres의 연결 슬롯을 다른 통합 테스트에서 빼앗는다.
 */
class PlaceEngineWiringTest {

	/** 엔진, 카탈로그, 키워드 검색 패키지만 훑는다. DB 모드 빈이 받는 JdbcClient와 JsonMapper는 가짜다. */
	@Configuration
	@ComponentScan(basePackages = {
			"kr.co.fitdining.api.place.catalog",
			"kr.co.fitdining.api.place.engine",
			"kr.co.fitdining.api.place.keyword"})
	static class Scan {
	}

	private static ApplicationContextRunner runner() {
		return new ApplicationContextRunner()
				.withUserConfiguration(Scan.class)
				.withBean(JdbcClient.class, () -> mock(JdbcClient.class))
				.withBean(JsonMapper.class, () -> JsonMapper.builder().build());
	}

	@Test
	@DisplayName("엔진배선_Mock을끄면_DB모드빈이하나씩만등록된다")
	void wiring_mockDisabled_registersCatalogModeBeansOnly() {
		runner().withPropertyValues("place.mock.enabled=false").run(context -> {
			assertThat(context).hasNotFailed();
			assertThat(context.getBeansOfType(PlaceSearchEngine.class).values()).singleElement()
					.isInstanceOf(CatalogPlaceSearchEngine.class);
			assertThat(context.getBeansOfType(PlaceCatalog.class)).hasSize(1);
			assertThat(context.getBeansOfType(PlaceKeywordSearch.class)).hasSize(1);
		});
	}

	@Test
	@DisplayName("엔진배선_스위치가없으면_DB모드다")
	void wiring_switchMissing_isCatalogMode() {
		runner().run(context -> {
			assertThat(context).hasNotFailed();
			assertThat(context.getBeansOfType(PlaceSearchEngine.class).values()).singleElement()
					.isInstanceOf(CatalogPlaceSearchEngine.class);
		});
	}

	static Stream<Arguments> oddSwitchValues() {
		return Stream.of(
				Arguments.of("", CatalogPlaceSearchEngine.class),
				Arguments.of("1", CatalogPlaceSearchEngine.class),
				Arguments.of("0", CatalogPlaceSearchEngine.class),
				Arguments.of("yes", CatalogPlaceSearchEngine.class),
				Arguments.of("on", CatalogPlaceSearchEngine.class),
				Arguments.of("no", CatalogPlaceSearchEngine.class),
				Arguments.of("False", CatalogPlaceSearchEngine.class),
				Arguments.of("True", MockPlaceSearchEngine.class),
				Arguments.of("TRUE", MockPlaceSearchEngine.class));
	}

	@ParameterizedTest(name = "place.mock.enabled=\"{0}\" → {1}")
	@MethodSource("oddSwitchValues")
	@DisplayName("엔진배선_스위치값이무엇이든_엔진빈은정확히하나다")
	void wiring_anySwitchValue_exactlyOneEngine(String value, Class<?> expected) {
		runner().withPropertyValues("place.mock.enabled=" + value).run(context -> {
			assertThat(context).hasNotFailed();
			assertThat(context.getBeansOfType(PlaceSearchEngine.class).values()).singleElement()
					.isInstanceOf(expected);
		});
	}

	@Test
	@DisplayName("엔진배선_Mock을켜면_Mock엔진만등록되고DB모드빈은없다")
	void wiring_mockEnabled_registersMockEngineOnly() {
		runner().withPropertyValues("place.mock.enabled=true").run(context -> {
			assertThat(context).hasNotFailed();
			assertThat(context.getBeansOfType(PlaceSearchEngine.class).values()).singleElement()
					.isInstanceOf(MockPlaceSearchEngine.class);
			assertThat(context.getBeansOfType(PlaceCatalog.class)).isEmpty();
			assertThat(context.getBeansOfType(PlaceKeywordSearch.class)).isEmpty();
		});
	}

}
