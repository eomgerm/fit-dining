package kr.co.fitdining.api.review.photo;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.type.AnnotatedTypeMetadata;

/** 저장소 접속 값이 모두 있을 때만 저장소를 만든다. 없으면 사진을 올리거나 확정할 때 503이고, 사진 없는 리뷰는 그대로 쓴다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ReviewPhotoProperties.class)
public class ReviewPhotoConfiguration {

	@Bean(destroyMethod = "close")
	@Conditional(StorageConfigured.class)
	S3PhotoStorage photoStorage(ReviewPhotoProperties properties) {
		return new S3PhotoStorage(properties);
	}

	static class StorageConfigured implements Condition {
		@Override
		public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
			return Binder.get(context.getEnvironment()).bind("review.photo", ReviewPhotoProperties.class)
					.map(ReviewPhotoProperties::configured).orElse(false);
		}
	}

}
