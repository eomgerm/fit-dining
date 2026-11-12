"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ignoreSdkError,
  type NaverCircle,
  type NaverMap,
  type NaverMarker,
} from "@/shared/lib/naver-maps";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { MapIcon } from "@/shared/ui/icon/icons/map";
import { PinIcon } from "@/shared/ui/icon/icons/pin";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { radiusLabel } from "../model/meetup";
import { PointPin } from "./point-pin";
import { RADIUS_CIRCLE, useNaverMaps } from "./use-naver-maps";

type Point = { name: string; lat: number; lng: number; radiusM: number };

// 원 전체를 지도에 넣을 때의 여백(px)과 최대 확대 정도
const FIT_MARGIN = 48;
const FIT_MAX_ZOOM = 17;

// 모임 정보의 지점 줄(AC-60). 위치 이름과 반경을 보이고, "지도 보기"로 전체 화면 지도를 연다
export function PointLocation(point: Point) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-2 rounded-md bg-surface py-1.5 pr-1.5 pl-3">
        <PinIcon size="sm" className="shrink-0 text-primary" />
        <p className="flex min-w-0 flex-1 items-baseline gap-1.5 text-label-md text-ink">
          {point.name && <span className="truncate">{point.name}</span>}
          <span className="shrink-0 text-caption-md text-ink-muted">
            반경 {radiusLabel(point.radiusM)}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface pr-3 pl-2.5 text-label-md whitespace-nowrap text-ink"
        >
          <MapIcon size="sm" />
          지도 보기
        </button>
      </div>
      {open && <PointMap {...point} onClose={() => setOpen(false)} />}
    </>
  );
}

// 지도 보기. 지점의 핀과 위치 이름, 반경 원을 그린 전체 화면 지도다. 지도 SDK는 이 화면을 열 때 불러오고, 불러오지 못하면
// 안내만 보인다
function PointMap({
  name,
  lat,
  lng,
  radiusM,
  onClose,
}: Point & { onClose: () => void }) {
  const maps = useNaverMaps();
  const containerRef = useRef<HTMLDivElement>(null);
  // 핀은 지도 마커의 내용으로 넣고 React가 그린다. 크기 없는 자리의 원점이 핀 끝이다
  const [pinSpot] = useState(() => {
    const spot = document.createElement("div");
    spot.className = "relative size-0";
    return spot;
  });
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (maps.status !== "ready" || !container) return;
    const { naver } = maps;
    let map: NaverMap | undefined;
    let circle: NaverCircle | undefined;
    let marker: NaverMarker | undefined;
    try {
      const center = new naver.LatLng(lat, lng);
      map = new naver.Map(container, {
        center,
        zoom: 15,
        mapDataControl: false,
        scaleControl: false,
      });
      circle = new naver.Circle({
        ...RADIUS_CIRCLE,
        map,
        center,
        radius: radiusM,
      });
      marker = new naver.Marker({
        map,
        position: center,
        icon: { content: pinSpot, anchor: new naver.Point(0, 0) },
      });
      map.fitBounds(circle.getBounds(), {
        top: FIT_MARGIN,
        right: FIT_MARGIN,
        bottom: FIT_MARGIN,
        left: FIT_MARGIN,
        maxZoom: FIT_MAX_ZOOM,
      });
    } catch {
      queueMicrotask(() => setBroken(true));
    }
    return () =>
      ignoreSdkError(() => {
        marker?.setMap(null);
        circle?.setMap(null);
        map?.destroy();
      });
  }, [maps, pinSpot, lat, lng, radiusM]);

  const failed = maps.status === "failed" || broken;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="모임 위치"
      className="fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <TopBar
        start={
          <IconButton label="뒤로" onClick={onClose}>
            <ChevronLeftIcon className="text-icon" />
          </IconButton>
        }
        title="모임 위치"
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          data-testid="point-map"
          className="absolute inset-0 bg-surface-sunken"
        />
        {failed && (
          <p className="absolute inset-x-4 top-3 rounded-md bg-surface/90 px-3 py-2 text-center text-caption-md text-balance text-ink-muted">
            지도를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.
          </p>
        )}
      </div>
      <section className="-mt-5 flex items-center gap-2 rounded-t-xl bg-surface px-5 pt-5 pb-safe-4 shadow-2">
        <PinIcon size="md" className="shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-title-sm text-ink">{name}</p>
        <span className="shrink-0 text-body-sm text-ink-muted">
          반경 {radiusLabel(radiusM)}
        </span>
      </section>
      {createPortal(
        <PointPin
          name={name}
          className="absolute bottom-0 left-0 -translate-x-1/2"
        />,
        pinSpot,
      )}
    </div>
  );
}
