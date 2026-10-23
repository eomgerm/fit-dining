package kr.co.fitdining.api.ops.dto;

/**
 * 실행 중인 이미지의 버전.
 *
 * @param sha 커밋 SHA(이미지의 {@code APP_SHA}). 로컬에서는 {@code unknown}이다.
 * @param builtAt 빌드 시각, UTC ISO 8601(이미지의 {@code APP_BUILT_AT}). 로컬에서는 {@code unknown}이다.
 */
public record VersionResponse(String sha, String builtAt) {
}
