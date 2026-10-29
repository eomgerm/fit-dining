package kr.co.fitdining.api.review.photo;

import java.time.Duration;
import java.util.stream.Stream;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 리뷰 사진 저장소 설정(D-9, D-45). 서버 값은 env 계약의 {@code S3_*} 키에서 온다.
 *
 * @param endpoint BE가 부르는 S3 API 주소
 * @param publicEndpoint 브라우저가 올리는 주소의 출처. presigned URL 서명에 이 Host가 들어간다.
 * @param readPrefix 확정 사진을 읽는 같은 출처 경로. {@code /}로 끝난다.
 * @param maxBytes 1,600px 사진 상한(PRD OQ-07 제안값)
 * @param thumbMaxBytes 썸네일 상한(PRD OQ-07 제안값)
 * @param uploadTtl 업로드 주소 수명
 */
@ConfigurationProperties("review.photo")
public record ReviewPhotoProperties(String endpoint, String publicEndpoint, String region, String bucket,
		String accessKey, String secretKey, boolean pathStyle, String readPrefix, long maxBytes, long thumbMaxBytes,
		Duration uploadTtl) {

	/** 저장소 접속 값이 모두 있는지. 없으면 사진을 올리거나 확정할 때 503이다. */
	public boolean configured() {
		return Stream.of(endpoint, publicEndpoint, region, bucket, accessKey, secretKey)
				.allMatch(value -> value != null && !value.isBlank());
	}

}
