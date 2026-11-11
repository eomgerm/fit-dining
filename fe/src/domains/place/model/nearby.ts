import type { LatLng } from "./place-types";

// 거리는 표시용으로만 계산한다. 근처 응답은 서버가 지도 영역으로 거른 결과라 FE가 거리로 거르지 않는다(D-111)

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// haversine. 지도 SDK의 getDistance는 키가 없으면 쓸 수 없어 직접 계산한다
export function distanceMeters(a: LatLng, b: LatLng) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// 10m 단위로 먼저 반올림해서 995m는 "1.0km"가 된다
export function formatDistance(meters: number) {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${rounded}m`;
  return `${(rounded / 1000).toFixed(1)}km`;
}
