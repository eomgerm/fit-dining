package kr.co.fitdining.api.place.catalog;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Conditional;

/**
 * DB 모드(카탈로그 DB로 응답하는 모드)의 빈 조건. Mock 엔진이 켜지지 않을 때 등록한다({@link CatalogModeCondition}).
 * Mock 엔진 조건의 정확한 부정이라 환경마다 {@code PlaceSearchEngine} 빈이 정확히 하나다(place-lookup-db D-2).
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Conditional(CatalogModeCondition.class)
public @interface ConditionalOnCatalogMode {
}
