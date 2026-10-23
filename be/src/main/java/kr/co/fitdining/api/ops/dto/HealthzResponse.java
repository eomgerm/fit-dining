package kr.co.fitdining.api.ops.dto;

/**
 * 공개 헬스 응답.
 *
 * @param status 상태. 응답했다면 {@code UP}이다.
 */
public record HealthzResponse(String status) {

	public static final HealthzResponse UP = new HealthzResponse("UP");

}
