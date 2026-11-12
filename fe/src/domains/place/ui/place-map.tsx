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
import {
  ignoreSdkError,
  loadNaverMaps,
  naverAuthFailed,
  onNaverAuthFailure,
  type NaverLatLng,
  type NaverMap,
  type NaverMaps,
  type NaverMarker,
} from "@/shared/lib/naver-maps";
import { loadRuntimeConfig } from "@/shared/lib/runtime-config";

import { DEFAULT_VIEW, type MapView } from "../model/map-view";
import type { LatLng, MapBounds } from "../model/place-types";
import { fitPlan, visibleBand } from "../model/visible-area";
import { readMapView, writeMapView } from "./map-view-storage";

// 첫 화면의 확대 정도. "내 위치"도 이 정도로 맞춘다(D-104)
const DEFAULT_ZOOM = DEFAULT_VIEW.zoom;
const PIN_SIZE = 28;
const SELECTED_PIN_SIZE = 40;
const LOCATION_PIN_SIZE = 32;
// panTo 뒤 지도가 멈췄다는 알림(idle)을 기다리는 최대 시간
const PAN_SETTLE_MS = 1500;
// 이만큼 가까우면 이미 그 위치다(위도·경도 차이, 약 1m)
const SAME_CENTER_DEG = 0.00001;
// 지금 화면이 시작 화면과 같은지 볼 때 허용하는 오차(도, 약 0.1m). 좌표를 지도 안에서 오가며 생기는 부동소수 오차를 넘긴다
const SAME_VIEW_EPSILON = 1e-6;
// 결과 맞춤 이동(fitBounds)의 네 방향 여백에 더하는 값. 선택된 핀 크기다(spec 69번)
const FIT_MARGIN = SELECTED_PIN_SIZE;
// 결과 맞춤 이동의 확대 정도 상한(fitBounds의 maxZoom). 가까운 몇 곳만 있을 때 과하게 확대하지 않는다
const FIT_MAX_ZOOM = 17;

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

function sameView(a: MapView, b: MapView) {
  return (
    Math.abs(a.lat - b.lat) < SAME_VIEW_EPSILON &&
    Math.abs(a.lng - b.lng) < SAME_VIEW_EPSILON &&
    Math.abs(a.zoom - b.zoom) < SAME_VIEW_EPSILON
  );
}

// 핀 안의 표시. 순위 번호, 저장한 장소의 북마크, 없음(위치 하나만 보이는 지도) 중 하나다
export type PinMark = number | "bookmark" | undefined;

export type MapPin = LatLng & { id: number; mark?: PinMark };

export type PlaceMapHandle = {
  // 지도가 없으면 undefined
  getBounds(): MapBounds | undefined;
  // 사용자에게 보이는 지도 영역(spec 65번). coverTop은 지도 아래쪽을 덮는 UI의 위 끝(화면 좌표 px)이고,
  // 지도 위쪽 safe-area와 그 UI가 겹친 높이를 뺀 띠를 위경도로 바꾼다. 띠가 너무 작거나 변환이 실패하면
  // getBounds() 전체, 지도가 없으면 undefined
  visibleBounds(coverTop?: number): MapBounds | undefined;
  // 지금 wrapper 크기를 SDK에 직접 알린(setSize) 뒤 바로 읽은 보이는 영역(spec 72번). 크기 변화를 기다리지 않는다.
  // 지도가 없거나 SDK가 던지면 undefined이고, 던지면 지도를 쓸 수 없는 상태가 된다
  boundsAfterResize(coverTop?: number): MapBounds | undefined;
  // 결과 맞춤 이동(spec 69번). 2곳 이상이면 fitBounds(확대 정도 상한 FIT_MAX_ZOOM), 1곳이면 panTo, 0곳이면 없음.
  // 코드 이동이라 사용자 이동으로 세지 않는다. 지도를 옮기기 시작했으면 true
  fitTo(points: LatLng[], coverTop?: number): boolean;
  // 지도가 그 위치로 이동을 마치면 끝난다. resetZoom이면 확대 정도도 처음 화면과 같게 맞추며
  // 함께 움직인다(D-104). 이미 그 위치(와 확대 정도)이거나 지도가 없으면 바로 끝난다
  panTo(coord: LatLng, options?: { resetZoom?: boolean }): Promise<void>;
};

type PlaceMapProps = {
  ref?: Ref<PlaceMapHandle>;
  pins: MapPin[];
  selectedId?: number;
  myLocation?: LatLng;
  // 처음 중심(정보 탭의 위치 지도). 없으면 기본 화면이다
  center?: LatLng;
  // 검색 지도. 마지막으로 본 화면을 기기에 저장해 두고 다음에 만들 때 그 화면에서 시작한다(spec 61번)
  rememberView?: boolean;
  onPinClick: (id: number) => void;
  // 사용자가 지도를 끌거나 확대·축소했을 때. panTo 같은 코드의 이동으로는 부르지 않는다
  onUserMove?: () => void;
  // 지도가 멈췄을 때(idle). 홈 영역 확정을 다시 시작하는 데 쓴다(spec 70번, 71번)
  onIdle?: () => void;
  // 지도가 그려졌는지. 지도 위 버튼("이 지역에서 검색", "내 위치")을 이것으로 보인다
  onReadyChange?: (ready: boolean) => void;
  // 지도를 쓸 수 없게 됐을 때(키 없음, 인증 실패, 지도를 없앰). 처음 이동을 끝내는 데 쓴다(spec 62번)
  onUnavailable?: () => void;
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
  rememberView = false,
  onPinClick,
  onUserMove,
  onIdle,
  onReadyChange,
  onUnavailable,
  className,
}: PlaceMapProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const safeTopRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ naver: NaverMaps; map: NaverMap }>();
  const [failed, setFailed] = useState(false);
  // 만든 지도. 화면이 숨겨져도 남겨 두었다가 다시 보일 때 그대로 쓴다
  const kept = useRef<{ naver: NaverMaps; map: NaverMap }>(undefined);
  // 처음 화면은 지도를 만들 때 한 번만 정한다. 기기 저장소는 브라우저에서만 읽는다
  const initialCenter = useRef(center);
  const remembers = useRef(rememberView);
  // 지도를 만들 때의 시작 화면(center·zoom). 지금 화면이 이것과 같으면 저장하지 않는다(spec 61번)
  const startView = useRef<MapView>(undefined);
  const markersRef = useRef(
    new Map<number, { marker: NaverMarker; mark?: PinMark; zIndex: number }>(),
  );
  // 멈춤(idle)을 기다리는 panTo들. 지도를 없애거나 지도가 실패하면 그 자리에서 끝낸다(지도가 없으면 바로 끝난다)
  const pendingPans = useRef(new Set<() => void>());
  // 인증이 실패하면 SDK 내부 값이 비어 어떤 호출이든 던지므로, 그 뒤에는 SDK를 부르지 않는다
  const active = failed ? undefined : loaded;
  const ready = Boolean(active);
  // 정리(cleanup) 중에도 지금의 콜백을 부르도록 둔다
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  });

  useEffect(() => {
    const container = containerRef.current;
    const pans = pendingPans.current;
    let cancelled = false;
    const fail = () => setFailed(true);
    const stopAuthFailure = onNaverAuthFailure(fail);

    if (!kept.current) {
      loadRuntimeConfig()
        .then((config) => {
          if (!config?.naverMapClientId) throw new Error("지도 키가 없습니다");
          return loadNaverMaps(config.naverMapClientId);
        })
        .then((naver) => {
          if (cancelled || !container) return;
          if (naverAuthFailed()) throw new Error("지도 인증에 실패했습니다");
          const start: MapView = initialCenter.current
            ? { ...initialCenter.current, zoom: DEFAULT_ZOOM }
            : (remembers.current && readMapView()) || DEFAULT_VIEW;
          const map = new naver.Map(container, {
            center: new naver.LatLng(start.lat, start.lng),
            zoom: start.zoom,
          });
          startView.current = start;
          kept.current = { naver, map };
          setLoaded(kept.current);
        })
        .catch(() => {
          if (!cancelled) fail();
        });
    }

    return () => {
      cancelled = true;
      stopAuthFailure();
      // 다른 화면으로 갈 때 Next가 이 화면을 숨겨 두면 지도 DOM이 그대로 남는다. 지도를 없애지 않아
      // 돌아왔을 때 보던 중심과 확대 정도가 그대로이고 지도 생성 횟수도 늘지 않는다(D-102)
      if (container?.isConnected) return;
      const map = kept.current?.map;
      kept.current = undefined;
      [...pans].forEach((finish) => finish());
      ignoreSdkError(() => map?.destroy());
      if (map) unavailable.current?.();
    };
  }, []);

  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  useEffect(() => {
    if (!failed) return;
    [...pendingPans.current].forEach((finish) => finish());
    unavailable.current?.();
  }, [failed]);

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
  const handleIdle = useEffectEvent(() => onIdle?.());
  // 코드가 확대 정도를 바꾸는 중인지(D-104). 그 움직임이 멈출 때(idle)까지 zoom_changed를 사용자 조작으로 세지 않는다
  const zoomingByCode = useRef(false);
  useEffect(() => {
    if (!active) return;
    const { naver, map } = active;
    const listeners: unknown[] = [];
    zoomingByCode.current = false;
    guard(() => {
      listeners.push(
        naver.Event.addListener(map, "dragend", () => handleUserMove()),
        naver.Event.addListener(map, "zoom_changed", () => {
          if (!zoomingByCode.current) handleUserMove();
        }),
        naver.Event.addListener(map, "idle", () => {
          zoomingByCode.current = false;
          handleIdle();
          if (!remembers.current) return;
          // 멈춤의 순서나 개수가 아니라 화면으로 정한다. 시작 화면 그대로면 쓰지 않고, 다르면 무엇이 옮겼든 쓴다(spec 61번)
          guard(() => {
            const center = map.getCenter();
            const view = {
              lat: center.lat(),
              lng: center.lng(),
              zoom: map.getZoom(),
            };
            if (startView.current && sameView(startView.current, view)) return;
            writeMapView(view);
          });
        }),
      );
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

  useImperativeHandle(ref, () => {
    const toBounds = (sw: NaverLatLng, ne: NaverLatLng): MapBounds => ({
      swLat: sw.lat(),
      swLng: sw.lng(),
      neLat: ne.lat(),
      neLng: ne.lng(),
    });
    // 지도 아래 끝에서 덮는 UI 위 끝까지(겹치지 않으면 0)
    const overlapOf = (rect: DOMRect | undefined, coverTop?: number) =>
      rect && coverTop !== undefined ? Math.max(rect.bottom - coverTop, 0) : 0;
    const safeTop = () => safeTopRef.current?.offsetHeight ?? 0;

    const handle: PlaceMapHandle = {
      getBounds() {
        if (!active) return;
        const bounds = active.map.getBounds();
        return toBounds(bounds.getSW(), bounds.getNE());
      },
      visibleBounds(coverTop) {
        if (!active) return;
        const { naver, map } = active;
        try {
          const rect = wrapperRef.current?.getBoundingClientRect();
          const band =
            rect &&
            visibleBand({
              height: rect.height,
              top: safeTop(),
              bottomOverlap: overlapOf(rect, coverTop),
            });
          if (rect && band) {
            const projection = map.getProjection();
            // 컨테이너 좌표를 offset으로 옮기려고 지금 화면 왼쪽 위(getBounds()의 북서 모서리)의 offset을 더한다
            const bounds = map.getBounds();
            const origin = projection.fromCoordToOffset(
              new naver.LatLng(bounds.getNE().lat(), bounds.getSW().lng()),
            );
            const toCoord = (x: number, y: number) =>
              projection.fromOffsetToCoord(
                new naver.Point(origin.x + x, origin.y + y),
              );
            return toBounds(
              toCoord(0, band.bottom),
              toCoord(rect.width, band.top),
            );
          }
        } catch {
          // 변환이 실패하면 지도 전체 영역으로 대신한다
        }
        return handle.getBounds();
      },
      boundsAfterResize(coverTop) {
        if (!active) return;
        const rect = wrapperRef.current?.getBoundingClientRect();
        try {
          // 결과 화면(지도 절반)에서 홈(지도 전체)으로 오면 ResizeObserver가 알리기 전이라 SDK는 아직 절반
          // 크기의 영역을 준다. 지금 크기를 직접 알려 기다리지 않고 읽는다
          if (rect)
            active.map.setSize(new active.naver.Size(rect.width, rect.height));
        } catch {
          // 인증 실패 알림처럼 렌더링 뒤에 지도를 비운다
          queueMicrotask(() => setFailed(true));
          return;
        }
        return handle.visibleBounds(coverTop);
      },
      fitTo(points, coverTop) {
        if (!active) return false;
        const plan = fitPlan(points);
        if (plan.kind === "none") return false;
        if (plan.kind === "pan") {
          void handle.panTo(plan.to);
          return true;
        }
        const { naver, map } = active;
        try {
          const before = { center: map.getCenter(), zoom: map.getZoom() };
          const rect = wrapperRef.current?.getBoundingClientRect();
          // fitBounds가 일으키는 zoom_changed를 사용자 조작으로 세지 않는다
          zoomingByCode.current = true;
          map.fitBounds(
            new naver.LatLngBounds(
              new naver.LatLng(plan.sw.lat, plan.sw.lng),
              new naver.LatLng(plan.ne.lat, plan.ne.lng),
            ),
            {
              top: safeTop() + FIT_MARGIN,
              right: FIT_MARGIN,
              bottom: overlapOf(rect, coverTop) + FIT_MARGIN,
              left: FIT_MARGIN,
              maxZoom: FIT_MAX_ZOOM,
            },
          );
          const center = map.getCenter();
          const moved =
            map.getZoom() !== before.zoom ||
            Math.abs(center.lat() - before.center.lat()) > SAME_CENTER_DEG ||
            Math.abs(center.lng() - before.center.lng()) > SAME_CENTER_DEG;
          // fitBounds는 부드러운 이동 없이 그 자리에서 바뀐다(SDK 문서. 부드러운 이동은 panToBounds다).
          // 움직였으면 멈춤(idle)에서 표시가 지워지고, 움직이지 않았으면 멈춤 알림이 없으니 바로 지운다
          if (!moved) zoomingByCode.current = false;
        } catch {
          zoomingByCode.current = false;
        }
        return true;
      },
      panTo({ lat, lng }, { resetZoom = false } = {}) {
        if (!active) return Promise.resolve();
        const { naver, map } = active;
        return new Promise<void>((resolve) => {
          let listener: unknown;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = () => {
            pendingPans.current.delete(finish);
            clearTimeout(timer);
            ignoreSdkError(() => naver.Event.removeListener(listener));
            resolve();
          };
          try {
            const center = map.getCenter();
            const zooms = resetZoom && map.getZoom() !== DEFAULT_ZOOM;
            const moves =
              zooms ||
              Math.abs(center.lat() - lat) > SAME_CENTER_DEG ||
              Math.abs(center.lng() - lng) > SAME_CENTER_DEG;
            if (moves) {
              pendingPans.current.add(finish);
              listener = naver.Event.addListener(map, "idle", finish);
              // 알림이 오지 않아도 기다림이 남지 않게 한다
              timer = setTimeout(finish, PAN_SETTLE_MS);
            }
            const coord = new naver.LatLng(lat, lng);
            if (resetZoom) {
              zoomingByCode.current = zooms;
              map.morph(coord, DEFAULT_ZOOM);
            } else {
              map.panTo(coord);
            }
            if (!moves) finish();
          } catch {
            finish();
          }
        });
      },
    };
    return handle;
  }, [active]);

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
      {/* 위쪽 safe-area 높이를 재는 빈 상자(보이는 영역과 맞춤 이동 여백에 쓴다) */}
      <div
        ref={safeTopRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 pt-safe-0"
      />
    </div>
  );
}
