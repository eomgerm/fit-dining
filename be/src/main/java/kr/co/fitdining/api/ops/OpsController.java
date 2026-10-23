package kr.co.fitdining.api.ops;

import kr.co.fitdining.api.ops.dto.HealthzResponse;
import kr.co.fitdining.api.ops.dto.VersionResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 배포와 외부 감시가 부르는 운영 API(docs/infra/design.md 12.1절 #2, #3).
 * 준비 상태는 관리 포트(8081)의 {@code /actuator/health/readiness}가 맡는다.
 */
@RestController
public class OpsController {

	private final VersionResponse version;

	public OpsController(@Value("${app.version.sha}") String sha,
			@Value("${app.version.built-at}") String builtAt) {
		this.version = new VersionResponse(sha, builtAt);
	}

	/**
	 * 외부 감시용 헬스. 공개 경로라 상태 외에 내부 정보(의존성, 버전)를 넣지 않는다.
	 *
	 * @return 항상 {@code UP}
	 */
	@GetMapping("/healthz")
	public HealthzResponse healthz() {
		return HealthzResponse.UP;
	}

	/**
	 * 실행 중인 이미지의 버전. 배포 스모크가 새 SHA로 바뀌었는지 확인한다.
	 *
	 * @return 커밋 SHA와 빌드 시각
	 */
	@GetMapping("/api/v1/version")
	public VersionResponse version() {
		return version;
	}

}
