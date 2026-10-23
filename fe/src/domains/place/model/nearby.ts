import type { LatLng, PlaceCard } from "./place-types";

const EARTH_RADIUS_M = 6_371_000;

// 근처 검색 반경. 최종 값은 미정이라 임시값이다(spec Open questions)
export const NEARBY_RADIUS_M = 1000;

// 기기 위치가 없을 때 첫 화면 주변 카드의 기준 지점이자 지도의 처음 중심
export const YEOKSAM_STATION: LatLng = { lat: 37.5006, lng: 127.0364 };

// 첫 화면 주변 카드의 최대 개수
export const NEARBY_PICK_LIMIT = 10;

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

export function filterNearby(
  cards: PlaceCard[],
  here: LatLng,
  radiusM = NEARBY_RADIUS_M,
) {
  return cards.filter((card) => distanceMeters(here, card.place) <= radiusM);
}

// 첫 화면 주변 카드. 근처 응답을 기준 지점에서 반경 안으로 거른 앞의 몇 곳
export function pickNearby(cards: PlaceCard[], origin: LatLng) {
  return filterNearby(cards, origin).slice(0, NEARBY_PICK_LIMIT);
}
