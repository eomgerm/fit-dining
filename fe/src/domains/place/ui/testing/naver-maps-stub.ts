import { act } from "@testing-library/react";
import { vi } from "vitest";

// 테스트용 가짜 네이버 지도 SDK. 검색 화면 테스트와 app 아래 통합 테스트가 같이 쓴다

// 가짜 지도의 getBounds() 전체 영역. 이미 0.001도 격자 위라 정규화해도 그대로다
export const BOUNDS = {
  swLat: 37.49,
  swLng: 127.02,
  neLat: 37.51,
  neLng: 127.05,
};

type Bounds = typeof BOUNDS;

// 네이버 지도 SDK 흉내. Marker만 바꿔 끼울 수 있다. fire로 지도 이벤트(사용자가 끌기 등)를 일으킨다
export function stubNaverMaps({ Marker }: { Marker?: unknown } = {}) {
  const listeners: { target: unknown; name: string; listener: () => void }[] =
    [];
  const latLng = (lat: number, lng: number) => ({
    lat: () => lat,
    lng: () => lng,
  });
  const created: {
    // 지도를 만들 때 넘긴 처음 중심과 확대 정도
    options: { center: { lat(): number; lng(): number }; zoom: number };
    setSize: ReturnType<typeof vi.fn>;
    panTo: ReturnType<typeof vi.fn>;
    morph: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
    setZoom: ReturnType<typeof vi.fn>;
    getCenter: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
  }[] = [];
  // 지도에 건 이벤트를 지금 바로 부른다(SDK가 확대 정도를 바꾸면 그 자리에서 zoom_changed를 알린다)
  const emit = (target: unknown, name: string) =>
    listeners
      .filter((entry) => entry.name === name && entry.target === target)
      .forEach(({ listener }) => listener());
  // 지금 getBounds() 영역. 테스트가 바꿔 사용자가 옮긴 화면을 흉내 낸다. afterSize가 있으면 다음 setSize 때 그 영역이 된다
  // (SDK가 크기를 적용한 뒤에야 영역이 바뀐다)
  const view: { bounds: Bounds; afterSize?: Bounds } = { bounds: BOUNDS };
  // fitBounds 뒤의 확대 정도. 테스트가 바꿔 "움직이지 않음"(15)이나 "너무 확대됨"(19)을 흉내 낸다
  const fit = { zoom: 16 };
  // 세계 좌표(px). 오른쪽으로 1000px마다 경도 1도, 아래로 1000px마다 위도 1도다
  const worldOf = (lat: number, lng: number) => ({
    x: (lng - 127) * 1000,
    y: (38 - lat) * 1000,
  });
  // 지금 화면 왼쪽 위(getBounds()의 북서 모서리)의 세계 좌표
  const topLeft = () => worldOf(view.bounds.neLat, view.bounds.swLng);
  const maps = {
    Map: class {
      constructor(
        _: unknown,
        readonly options: {
          center: { lat(): number; lng(): number };
          zoom: number;
        },
      ) {
        created.push(this);
      }
      getBounds = () => ({
        getSW: () => latLng(view.bounds.swLat, view.bounds.swLng),
        getNE: () => latLng(view.bounds.neLat, view.bounds.neLng),
      });
      // 처음 중심은 기기 위치와 멀다. 테스트가 바꿔 "이미 그 위치"를 흉내 낸다
      getCenter = vi.fn(() => latLng(0, 0));
      // 처음 확대 정도. 테스트가 바꿔 사용자가 확대·축소해 둔 지도를 흉내 낸다
      getZoom = vi.fn(() => 15);
      panTo = vi.fn();
      morph = vi.fn();
      // offset 원점의 세계 좌표. 실제 SDK처럼 offset은 지도 컨테이너가 아니라 끌 때 함께 움직이는 pane 기준이고,
      // 그 원점은 지도를 만들 때와 확대 정도가 바뀔 때만 그때 화면 왼쪽 위로 다시 잡힌다. 그래서 끌기나 panTo
      // (테스트가 view.bounds를 바꿈) 뒤에는 offset (0, 0)이 옮기기 전 화면의 왼쪽 위다
      pane = topLeft();
      getProjection = () => ({
        fromOffsetToCoord: ({ x, y }: { x: number; y: number }) =>
          latLng(38 - (this.pane.y + y) / 1000, 127 + (this.pane.x + x) / 1000),
        fromCoordToOffset: (coord: { lat(): number; lng(): number }) => {
          const world = worldOf(coord.lat(), coord.lng());
          return { x: world.x - this.pane.x, y: world.y - this.pane.y };
        },
      });
      // 문서대로 부드러운 이동 없이 그 자리에서 중심과 확대 정도를 바꾸고, 옵션의 maxZoom을 넘지 않는다
      fitBounds = vi.fn((_: unknown, options?: { maxZoom?: number }) => {
        const zoom = Math.min(fit.zoom, options?.maxZoom ?? Infinity);
        if (zoom === this.getZoom()) return;
        this.getZoom.mockReturnValue(zoom);
        this.pane = topLeft();
        emit(this, "zoom_changed");
      });
      setZoom = vi.fn((zoom: number) => {
        this.getZoom.mockReturnValue(zoom);
        this.pane = topLeft();
        emit(this, "zoom_changed");
      });
      setSize = vi.fn(() => {
        if (!view.afterSize) return;
        view.bounds = view.afterSize;
        view.afterSize = undefined;
      });
      destroy() {}
    },
    LatLng: class {
      constructor(
        readonly latValue: number,
        readonly lngValue: number,
      ) {}
      lat = () => this.latValue;
      lng = () => this.lngValue;
    },
    LatLngBounds: class {
      constructor(
        readonly sw: { lat(): number; lng(): number },
        readonly ne: { lat(): number; lng(): number },
      ) {}
    },
    Size: class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
    },
    Point: class {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
    },
    Marker:
      Marker ??
      class {
        setMap() {}
        setIcon() {}
        setZIndex() {}
      },
    Event: {
      addListener(target: unknown, name: string, listener: () => void) {
        const entry = { target, name, listener };
        listeners.push(entry);
        return entry;
      },
      removeListener(entry: unknown) {
        listeners.splice(listeners.indexOf(entry as never), 1);
      },
    },
  };
  vi.stubGlobal("naver", { maps });
  // 지도에 건 이벤트만 일으킨다
  const fire = (name: string) =>
    act(() =>
      listeners
        .filter(
          (entry) =>
            entry.name === name && created.includes(entry.target as never),
        )
        .forEach(({ listener }) => listener()),
    );
  return { created, fire, fit, view };
}
