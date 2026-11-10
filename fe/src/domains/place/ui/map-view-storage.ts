import { MAP_VIEW_KEY, parseMapView, type MapView } from "../model/map-view";

// 검색 지도의 마지막 화면을 기기에 읽고 쓴다. 저장소를 쓸 수 없는 브라우저(막힘, 사생활 보호 모드)에서도
// 지도는 기본 화면으로 그려져야 하므로 예외는 삼킨다(spec 61번)

export function readMapView(): MapView | undefined {
  try {
    return parseMapView(localStorage.getItem(MAP_VIEW_KEY));
  } catch {
    return undefined;
  }
}

export function writeMapView(view: MapView) {
  try {
    localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(view));
  } catch {}
}
