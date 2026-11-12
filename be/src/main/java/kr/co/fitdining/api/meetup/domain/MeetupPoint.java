package kr.co.fitdining.api.meetup.domain;

/**
 * 모임 지점과 반경(④ 모임 지점, AC-58). 거리는 AI의 반경 거르기(`candidates.distance_m`)와 같은 하버사인 공식으로 잰다.
 *
 * @param lat 위도
 * @param lng 경도
 * @param radiusM 반경(m). {@link MeetupLimits#RADII} 중 하나다.
 */
public record MeetupPoint(double lat, double lng, int radiusM) {

	private static final double EARTH_RADIUS_M = 6_371_000;

	/** 위도·경도가 범위 안이고 반경이 고를 수 있는 값인지. 값이 없거나 숫자가 아니면 false다. */
	public static boolean valid(Double lat, Double lng, Integer radiusM) {
		return lat != null && lng != null && radiusM != null && lat >= -90 && lat <= 90 && lng >= -180
				&& lng <= 180 && MeetupLimits.RADII.contains(radiusM);
	}

	/** 지점에서 그 좌표까지의 직선거리(m) */
	public double metersTo(double lat, double lng) {
		double h = Math.pow(Math.sin(Math.toRadians(lat - this.lat) / 2), 2)
				+ Math.cos(Math.toRadians(this.lat)) * Math.cos(Math.toRadians(lat))
						* Math.pow(Math.sin(Math.toRadians(lng - this.lng) / 2), 2);
		return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1.0, Math.sqrt(h)));
	}

	/** 반경 안인지. 경계에 있으면 안이다. */
	public boolean contains(double lat, double lng) {
		return metersTo(lat, lng) <= radiusM;
	}

}
