"use client";

import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

import { cn } from "@/shared/lib/cn";
import { loadRuntimeConfig } from "@/shared/lib/runtime-config";

import { YEOKSAM_STATION } from "../model/nearby";
import type { LatLng, MapBounds } from "../model/place-types";

// 네이버 지도 웹 SDK(JavaScript v3)에서 쓰는 부분만 적은 타입
type NaverLatLng = { lat(): number; lng(): number };
type NaverMap = {
  getBounds(): { getSW(): NaverLatLng; getNE(): NaverLatLng };
  getCenter(): NaverLatLng;
  panTo(coord: NaverLatLng): void;
  setSize(size: unknown): void;
  destroy(): void;
};
type NaverMarker = {
  setMap(map: NaverMap | null): void;
  setIcon(icon: unknown): void;
  setZIndex(zIndex: number): void;
  setPosition(coord: NaverLatLng): void;
};
type NaverMaps = {
  Map: new (element: HTMLElement, options: object) => NaverMap;
  LatLng: new (lat: number, lng: number) => NaverLatLng;
  Marker: new (options: object) => NaverMarker;
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

// 역삼역. 결과에 맞춰 화면을 옮기지 않으므로(fitBounds 없음) 처음 중심이다
const DEFAULT_CENTER = YEOKSAM_STATION;
const DEFAULT_ZOOM = 15;
const PIN_SIZE = 28;
const SELECTED_PIN_SIZE = 40;
const LOCATION_PIN_SIZE = 32;
// panTo 뒤 지도가 멈췄다는 알림(idle)을 기다리는 최대 시간
const PAN_SETTLE_MS = 1500;
// 이만큼 가까우면 이미 그 위치다(위도·경도 차이, 약 1m)
const SAME_CENTER_DEG = 0.00001;

let scriptPromise: Promise<NaverMaps> | undefined;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

// 스크립트는 페이지 세션에 한 번만 넣는다. 인증 실패 알림은 넣기 전에 걸어 둔다
function loadNaverMaps(clientId: string) {
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

// 물방울 핀(와이어프레임 fd-pin-selected). 한 모서리만 작게 둥근 정사각형을 -45도 돌려 그 모서리가 아래를 향한다.
// 안쪽 내용은 다시 45도 돌려 바로 세운다. 기준점은 아래 끝(중심에서 한 변/√2 아래, 모서리가 둥근 만큼 조금 위)이다
function dropPin(
  naver: NaverMaps,
  size: number,
  sizeClass: string,
  inner: string,
) {
  return {
    content: `<div class="flex ${sizeClass} -rotate-45 items-center justify-center rounded-full rounded-bl-xs bg-primary text-title-sm text-on-primary shadow-pin"><span class="flex rotate-45 items-center justify-center">${inner}</span></div>`,
    anchor: new naver.Point(
      size / 2,
      Math.round(size / 2 + size / Math.SQRT2) - 2,
    ),
  };
}

const BOOKMARK_PIN_SIZE = 30;
const BOOKMARK_SVG =
  '<svg viewBox="0 0 24 24" class="size-4" aria-hidden="true"><path d="M6 4H18V21L12 17L6 21V4Z" fill="currentColor"/></svg>';

// 선택된 핀은 순위 번호가 든 물방울, 나머지는 순위 번호가 든 흰 원이다.
// 저장한 장소 핀은 순위 없이 북마크가 든 주황 원이고, 선택되면 북마크가 든 물방울이다(와이어프레임 Saved).
// 표시가 없으면(정보 탭의 위치 지도) 가운데에 흰 원이 든 조금 작은 물방울이다
function pinIcon(naver: NaverMaps, mark: PinMark, selected: boolean) {
  if (mark === "bookmark") {
    if (selected)
      return dropPin(naver, SELECTED_PIN_SIZE, "size-10", BOOKMARK_SVG);
    return {
      content: `<div class="flex size-7.5 items-center justify-center rounded-full bg-primary text-on-primary shadow-pin">${BOOKMARK_SVG}</div>`,
      anchor: new naver.Point(BOOKMARK_PIN_SIZE / 2, BOOKMARK_PIN_SIZE / 2),
    };
  }
  if (mark === undefined) {
    return dropPin(
      naver,
      LOCATION_PIN_SIZE,
      "size-8",
      '<span class="size-3 rounded-full bg-surface"></span>',
    );
  }
  if (selected) return dropPin(naver, SELECTED_PIN_SIZE, "size-10", `${mark}`);
  return {
    content: `<div class="flex size-7 items-center justify-center rounded-full border border-icon-subtle bg-surface text-label-sm text-ink shadow-1">${mark}</div>`,
    anchor: new naver.Point(PIN_SIZE / 2, PIN_SIZE / 2),
  };
}

const MY_LOCATION_ICON =
  '<div class="flex size-8 items-center justify-center rounded-full bg-location-halo"><div class="size-3.5 rounded-full border-2 border-surface bg-location"></div></div>';

// 정리(cleanup) 중에는 SDK가 던져도 할 일이 없다
function ignoreSdkError(call: () => void) {
  try {
    call();
  } catch {}
}

// 핀 안의 표시. 순위 번호, 저장한 장소의 북마크, 없음(위치 하나만 보이는 지도) 중 하나다
export type PinMark = number | "bookmark" | undefined;

export type MapPin = LatLng & { id: number; mark?: PinMark };

export type PlaceMapHandle = {
  // 지도가 없으면 undefined
  getBounds(): MapBounds | undefined;
  // 지도가 그 위치로 이동을 마치면 끝난다. 이미 그 위치이거나 지도가 없으면 바로 끝난다
  panTo(coord: LatLng): Promise<void>;
};

type PlaceMapProps = {
  ref?: Ref<PlaceMapHandle>;
  pins: MapPin[];
  selectedId?: number;
  myLocation?: LatLng;
  // 처음 중심. 없으면 역삼역이다
  center?: LatLng;
  onPinClick: (id: number) => void;
  // 사용자가 지도를 끌거나 확대·축소했을 때. panTo 같은 코드의 이동으로는 부르지 않는다
  onUserMove?: () => void;
  // 지도가 그려졌는지. 지도 위 버튼("이 지역에서 검색", "내 위치")을 이것으로 보인다
  onReadyChange?: (ready: boolean) => void;
  className?: string;
};

// 지도 키가 없거나, 키를 받지 못했거나, 인증이 실패하면 지도 영역을 비운다.
// 지도는 한 번만 만들고(사용량이 지도 생성 횟수로 집계된다) 결과가 바뀌면 핀만 바꾼다
export function PlaceMap({
  ref,
  pins,
  selectedId,
  myLocation,
  center,
  onPinClick,
  onUserMove,
  onReadyChange,
  className,
}: PlaceMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ naver: NaverMaps; map: NaverMap }>();
  const [failed, setFailed] = useState(false);
  // 만든 지도. 화면이 숨겨져도 남겨 두었다가 다시 보일 때 그대로 쓴다
  const kept = useRef<{ naver: NaverMaps; map: NaverMap }>(undefined);
  // 처음 중심은 지도를 만들 때 한 번만 쓴다
  const initialCenter = useRef(center ?? DEFAULT_CENTER);
  const markersRef = useRef(
    new Map<number, { marker: NaverMarker; mark?: PinMark; zIndex: number }>(),
  );
  // 인증이 실패하면 SDK 내부 값이 비어 어떤 호출이든 던지므로, 그 뒤에는 SDK를 부르지 않는다
  const active = failed ? undefined : loaded;
  const ready = Boolean(active);

  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;
    const fail = () => setFailed(true);
    authFailureListeners.add(fail);

    if (!kept.current) {
      loadRuntimeConfig()
        .then((config) => {
          if (!config?.naverMapClientId) throw new Error("지도 키가 없습니다");
          return loadNaverMaps(config.naverMapClientId);
        })
        .then((naver) => {
          if (cancelled || !container) return;
          if (authFailed) throw new Error("지도 인증에 실패했습니다");
          const map = new naver.Map(container, {
            center: new naver.LatLng(
              initialCenter.current.lat,
              initialCenter.current.lng,
            ),
            zoom: DEFAULT_ZOOM,
          });
          kept.current = { naver, map };
          setLoaded(kept.current);
        })
        .catch(() => {
          if (!cancelled) fail();
        });
    }

    return () => {
      cancelled = true;
      authFailureListeners.delete(fail);
      // 다른 화면으로 갈 때 Next가 이 화면을 숨겨 두면 지도 DOM이 그대로 남는다. 지도를 없애지 않아
      // 돌아왔을 때 보던 중심과 확대 정도가 그대로이고 지도 생성 횟수도 늘지 않는다(D-102)
      if (container?.isConnected) return;
      const map = kept.current?.map;
      kept.current = undefined;
      ignoreSdkError(() => map?.destroy());
    };
  }, []);

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  // 인증 실패 알림보다 먼저 SDK가 던지는 경우도 지도를 비운다. 실패 알림처럼 렌더링 뒤에 바꾼다
  const guard = useEffectEvent((call: () => void) => {
    try {
      call();
    } catch {
      queueMicrotask(() => setFailed(true));
    }
  });

  // 옵션에 size가 없으면 처음 컨테이너 크기로 고정되므로, 크기가 바뀔 때마다 알려 준다.
  // SDK가 setSize 뒤 안쪽 div에 px 크기를 직접 넣어 안쪽은 더 바뀌지 않으므로, CSS로 크기가 정해지는 바깥을 본다
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!active || !wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      guard(() => active.map.setSize(new active.naver.Size(width, height)));
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [active]);

  const handleUserMove = useEffectEvent(() => onUserMove?.());
  // 우리 코드는 확대·축소를 바꾸지 않으므로 zoom_changed는 사용자의 조작이다
  useEffect(() => {
    if (!active) return;
    const { naver, map } = active;
    const listeners: unknown[] = [];
    guard(() => {
      for (const name of ["dragend", "zoom_changed"]) {
        listeners.push(
          naver.Event.addListener(map, name, () => handleUserMove()),
        );
      }
    });
    return () =>
      ignoreSdkError(() =>
        listeners.forEach((listener) => naver.Event.removeListener(listener)),
      );
  }, [active]);

  const handlePinClick = useEffectEvent((id: number) => onPinClick(id));
  // 부모가 매번 새 배열을 넘겨도 내용이 같으면 핀을 다시 만들지 않는다
  const pinsKey = pins
    .map(({ id, mark, lat, lng }) => `${id}:${mark}:${lat}:${lng}`)
    .join("|");
  const currentPins = useEffectEvent(() => pins);

  useEffect(() => {
    if (!active) return;
    const { naver, map } = active;
    const markers = markersRef.current;
    const listeners: unknown[] = [];
    guard(() => {
      const pins = currentPins();
      for (const { id, mark, lat, lng } of pins) {
        // 앞 순위 핀이 위에 그려진다
        const zIndex = pins.length - (typeof mark === "number" ? mark : 0);
        const marker = new naver.Marker({
          position: new naver.LatLng(lat, lng),
          map,
          icon: pinIcon(naver, mark, false),
          zIndex,
        });
        markers.set(id, { marker, mark, zIndex });
        listeners.push(
          naver.Event.addListener(marker, "click", () => handlePinClick(id)),
        );
      }
    });
    return () => {
      ignoreSdkError(() => {
        listeners.forEach((listener) => naver.Event.removeListener(listener));
        markers.forEach(({ marker }) => marker.setMap(null));
      });
      markers.clear();
    };
  }, [active, pinsKey]);

  useEffect(() => {
    if (!active) return;
    const markers = markersRef.current;
    const selected =
      selectedId === undefined ? undefined : markers.get(selectedId);
    if (!selected) return;
    guard(() => {
      selected.marker.setIcon(pinIcon(active.naver, selected.mark, true));
      selected.marker.setZIndex(markers.size + 1);
    });
    return () =>
      ignoreSdkError(() => {
        selected.marker.setIcon(pinIcon(active.naver, selected.mark, false));
        selected.marker.setZIndex(selected.zIndex);
      });
  }, [active, pinsKey, selectedId]);

  useEffect(() => {
    if (!active || !myLocation) return;
    const { naver, map } = active;
    let marker: NaverMarker | undefined;
    guard(() => {
      marker = new naver.Marker({
        position: new naver.LatLng(myLocation.lat, myLocation.lng),
        map,
        clickable: false,
        icon: { content: MY_LOCATION_ICON, anchor: new naver.Point(16, 16) },
      });
    });
    return () => ignoreSdkError(() => marker?.setMap(null));
  }, [active, myLocation]);

  useImperativeHandle(
    ref,
    () => ({
      getBounds() {
        if (!active) return;
        const bounds = active.map.getBounds();
        const sw = bounds.getSW();
        const ne = bounds.getNE();
        return {
          swLat: sw.lat(),
          swLng: sw.lng(),
          neLat: ne.lat(),
          neLng: ne.lng(),
        };
      },
      panTo({ lat, lng }) {
        if (!active) return Promise.resolve();
        const { naver, map } = active;
        return new Promise<void>((resolve) => {
          let listener: unknown;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = () => {
            clearTimeout(timer);
            ignoreSdkError(() => naver.Event.removeListener(listener));
            resolve();
          };
          try {
            const center = map.getCenter();
            const moves =
              Math.abs(center.lat() - lat) > SAME_CENTER_DEG ||
              Math.abs(center.lng() - lng) > SAME_CENTER_DEG;
            if (moves) {
              listener = naver.Event.addListener(map, "idle", finish);
              // 알림이 오지 않아도 기다림이 남지 않게 한다
              timer = setTimeout(finish, PAN_SETTLE_MS);
            }
            map.panTo(new naver.LatLng(lat, lng));
            if (!moves) finish();
          } catch {
            finish();
          }
        });
      },
    }),
    [active],
  );

  // SDK가 지도 컨테이너에 position: relative를 직접 넣으므로, 배치는 바깥 div가 맡고
  // SDK에는 바깥을 꽉 채우는 안쪽 div를 넘긴다. SDK 로고·축척의 z-index는 isolate로 지도 안에 가둔다
  return (
    <div
      ref={wrapperRef}
      data-map-state={failed ? "empty" : ready ? "ready" : "loading"}
      aria-hidden={!ready}
      className={cn(
        "isolate overflow-hidden bg-map-bg",
        // 지도를 쓸 수 없으면 자리를 차지하지 않는다(정보 탭의 위치 지도도 접힌다)
        failed && "hidden",
        className,
      )}
    >
      <div ref={containerRef} className="size-full" />
    </div>
  );
}
