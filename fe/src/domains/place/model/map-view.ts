// 검색 지도의 화면(중심과 확대 정도). 마지막으로 본 화면을 기기에 두었다가 다음에 열 때 그 화면에서 시작한다(spec 61번)
export type MapView = { lat: number; lng: number; zoom: number };

// 저장된 화면이 없는 처음 쓰는 기기의 시작 화면. SSAFY 서울캠퍼스(멀티캠퍼스 역삼)다
export const DEFAULT_VIEW: MapView = { lat: 37.5013, lng: 127.0396, zoom: 15 };

export const MAP_VIEW_KEY = "fd.map.view.v1";

// 네이버 지도 기본 확대 범위
const MIN_ZOOM = 6;
const MAX_ZOOM = 21;

const within = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

// 기기에 저장된 문자열을 읽는다. 하나라도 어긋나면 값 전체를 버린다. 세 값 밖의 키는 보지 않는다
export function parseMapView(raw: string | null): MapView | undefined {
  if (raw === null) return;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const { lat, lng, zoom } = value as Record<string, unknown>;
  if (
    !within(lat, -90, 90) ||
    !within(lng, -180, 180) ||
    !within(zoom, MIN_ZOOM, MAX_ZOOM)
  )
    return;
  return { lat, lng, zoom };
}
