// 방문 확인(D-12). 계산은 기기에서만 하고 좌표와 결과를 서버로 보내지 않는다

export const NEARBY_METERS = 100;

export type LatLng = { lat: number; lng: number };

// accuracy는 기기가 알려 준 오차 반경(m)이다
export type DevicePosition = LatLng & { accuracy: number };

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

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

// "측정 거리 + GPS 정확도 ≤ 100m"면 근처다. 장소 좌표를 모르면 확인하지 못한 것으로 본다
export function isNearby(place: Partial<LatLng>, position: DevicePosition) {
  if (place.lat === undefined || place.lng === undefined) return false;
  const distance = distanceMeters({ lat: place.lat, lng: place.lng }, position);
  return distance + position.accuracy <= NEARBY_METERS;
}
