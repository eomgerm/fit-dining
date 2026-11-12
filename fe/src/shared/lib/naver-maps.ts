// 네이버 지도 웹 SDK(JavaScript v3)의 스크립트 로더와 쓰는 부분만 적은 타입. 장소 지도와 모임 지도가 함께 쓴다
// (meetup D-20)

export type NaverLatLng = { lat(): number; lng(): number };
export type NaverMap = {
  getBounds(): { getSW(): NaverLatLng; getNE(): NaverLatLng };
  getCenter(): NaverLatLng;
  getZoom(): number;
  // offset(px)과 위경도를 서로 바꾼다. offset은 지도 컨테이너가 아니라 끌 때 함께 움직이는 pane 기준이고,
  // 그 원점은 확대 정도가 바뀔 때만 다시 잡힌다(끌기나 panTo 뒤에는 옮기기 전 화면의 왼쪽 위다)
  getProjection(): {
    fromOffsetToCoord(offset: unknown): NaverLatLng;
    fromCoordToOffset(coord: NaverLatLng): { x: number; y: number };
  };
  panTo(coord: NaverLatLng): void;
  morph(coord: NaverLatLng, zoom: number): void;
  // 여백(px)과 최대 확대 정도. 부드러운 이동 없이 바로 옮긴다(FitBoundsOptions)
  fitBounds(
    bounds: unknown,
    options: {
      top: number;
      right: number;
      bottom: number;
      left: number;
      maxZoom: number;
    },
  ): void;
  setSize(size: unknown): void;
  destroy(): void;
};
export type NaverMarker = {
  setMap(map: NaverMap | null): void;
  setIcon(icon: unknown): void;
  setZIndex(zIndex: number): void;
  setPosition(coord: NaverLatLng): void;
};
export type NaverCircle = {
  setMap(map: NaverMap | null): void;
  setCenter(coord: NaverLatLng): void;
  setRadius(meters: number): void;
  getBounds(): unknown;
};
export type NaverMaps = {
  Map: new (element: HTMLElement, options: object) => NaverMap;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  LatLngBounds: new (sw: NaverLatLng, ne: NaverLatLng) => unknown;
  Marker: new (options: object) => NaverMarker;
  Circle: new (options: object) => NaverCircle;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Event: {
    addListener(target: unknown, name: string, listener: () => void): unknown;
    removeListener(listener: unknown): void;
  };
};

declare global {
  interface Window {
    naver?: { maps?: NaverMaps };
    navermap_authFailure?: () => void;
  }
}

let scriptPromise: Promise<NaverMaps> | undefined;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

// 스크립트는 페이지 세션에 한 번만 넣는다. 인증 실패 알림은 넣기 전에 걸어 둔다
export function loadNaverMaps(clientId: string) {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  scriptPromise ??= new Promise<NaverMaps>((resolve, reject) => {
    window.navermap_authFailure = () => {
      authFailed = true;
      authFailureListeners.forEach((listener) => listener());
    };
    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.async = true;
    script.onload = () => {
      const maps = window.naver?.maps;
      if (maps) resolve(maps);
      else reject(new Error("naver.maps를 찾지 못했습니다"));
    };
    script.onerror = () => reject(new Error("지도 스크립트를 받지 못했습니다"));
    document.head.append(script);
  });
  return scriptPromise;
}

// 지도 인증이 실패했는지. 스크립트는 받았어도 키가 틀리면 SDK가 나중에 알린다
export function naverAuthFailed() {
  return authFailed;
}

// 지도 인증 실패를 알린다. 돌려주는 함수로 알림을 끊는다
export function onNaverAuthFailure(listener: () => void) {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

// 인증에 실패한 SDK는 지도 객체를 다룰 때 던진다. 화면 전체의 오류로 번지지 않게 막고, 지도는 실패 알림이 치운다
export function ignoreSdkError(call: () => void) {
  try {
    call();
  } catch {}
}
