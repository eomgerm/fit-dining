package kr.co.fitdining.api.place.catalog;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;

/**
 * DB 모드(카탈로그 DB로 응답하는 모드)의 빈 조건. {@code place.mock.enabled}가 꺼졌거나 없을 때만 등록한다. Mock 엔진은
 * 반대 조건이라 환경마다 {@code PlaceSearchEngine} 빈이 정확히 하나다(place-lookup-db D-2).
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@ConditionalOnBooleanProperty(name = "place.mock.enabled", havingValue = false, matchIfMissing = true)
public @interface ConditionalOnCatalogMode {
}
