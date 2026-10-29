package kr.co.fitdining.api.place.catalog;

import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.NoneNestedConditions;
import org.springframework.context.annotation.ConfigurationCondition;

/**
 * DB 모드의 조건. Mock 엔진의 조건({@code @ConditionalOnBooleanProperty("place.mock.enabled")})이 맞지 않을 때 맞는다.
 * 스위치 값이 {@code false}이거나 없거나, 비어 있거나, {@code yes}, {@code 1}처럼 불리언으로 읽히지 않아도 Mock 아니면
 * DB 모드가 되어 엔진 빈이 환경마다 정확히 하나다. 두 조건을 각각 {@code havingValue}로 쓰면 이런 값에서 둘 다 꺼진다.
 */
class CatalogModeCondition extends NoneNestedConditions {

	CatalogModeCondition() {
		super(ConfigurationCondition.ConfigurationPhase.REGISTER_BEAN);
	}

	@ConditionalOnBooleanProperty("place.mock.enabled")
	static class MockEnabled {
	}

}
