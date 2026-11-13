"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import {
  ignoreSdkError,
  type NaverCircle,
  type NaverMap,
  type NaverMaps,
} from "@/shared/lib/naver-maps";
import { Button } from "@/shared/ui/button/button";
import { Chip } from "@/shared/ui/button/chip";
import { Fab } from "@/shared/ui/button/fab";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Note } from "@/shared/ui/display/note";
import { TextField } from "@/shared/ui/form/text-field";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { MyLocationIcon } from "@/shared/ui/icon/icons/my-location";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { useAreaCheck, type WithSession } from "../api/queries";
import {
  POINT_NAME_MAX,
  RADII,
  radiusLabel,
  type MeetupArea,
  type MeetupRadius,
} from "../model/meetup";
import { PointPin } from "./point-pin";
import { RADIUS_CIRCLE } from "./use-naver-maps";

type PointArea = Extract<MeetupArea, { kind: "POINT" }>;
type Center = { lat: number; lng: number };

// 처음 여는 지도의 가운데(강남역)와 확대 정도
const DEFAULT_CENTER: Center = { lat: 37.4979, lng: 127.0276 };
const DEFAULT_ZOOM = 15;
// 원 전체를 지도에 넣을 때의 여백(px)과 최대 확대 정도
const FIT_MARGIN = 24;
const FIT_MAX_ZOOM = 18;

// 지점은 소수 넷째 자리(약 10m)로 맞춘다. 장소 수를 센 지점과 보내는 지점을 같게 둔다
function rounded(lat: number, lng: number): Center {
  return {
    lat: Math.round(lat * 1e4) / 1e4,
    lng: Math.round(lng * 1e4) / 1e4,
  };
}

// 지도에서 고르기(모임장 4, AC-60). 핀은 지도 가운데에 고정되고 지도를 움직여 맞춘다. 반경을 바꾸면 원 전체가 지도에 들어온다.
// "내 위치"는 지도만 옮기고 서버로 가는 요청에는 기기 위치에서 왔다는 표시가 없다. 반경 안에 장소가 없으면 정할 수 없다
export function MapPick({
  naver,
  initial,
  withSession,
  onUnauthorized,
  onClose,
  onPick,
}: {
  naver: NaverMaps;
  initial?: PointArea;
  withSession: WithSession;
  onUnauthorized: () => void;
  onClose: () => void;
  onPick: (area: PointArea) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shown = useRef<{ map: NaverMap; circle: NaverCircle }>(undefined);
  const start = useRef(initial ?? null);
  const [center, setCenter] = useState<Center>(() =>
    initial ? rounded(initial.lat, initial.lng) : DEFAULT_CENTER,
  );
  const [radiusM, setRadiusM] = useState<MeetupRadius>(initial?.radiusM ?? 500);
  // 이름을 고친 뒤로는 붙인 이름으로 바꾸지 않는다
  const [ownName, setOwnName] = useState<string | null>(initial?.name ?? null);
  const [locationFailed, setLocationFailed] = useState(false);
  const check = useAreaCheck({ ...center, radiusM }, withSession);
  const radioName = useId();
  // 인증 실패 알림보다 먼저 SDK가 던지면 고르기를 닫는다. 곧 오는 실패 알림이 "지도에서 고르기"를 숨긴다
  const closeBroken = useEffectEvent(() => onClose());

  useEffect(() => {
    if (isApiError(check.error) && check.error.status === 401) {
      onUnauthorized();
    }
  }, [check.error, onUnauthorized]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const first = start.current;
    let map: NaverMap | undefined;
    let circle: NaverCircle | undefined;
    const listeners: unknown[] = [];
    try {
      const at = first ? new naver.LatLng(first.lat, first.lng) : null;
      const shownMap = new naver.Map(container, {
        center: at ?? new naver.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
        zoom: DEFAULT_ZOOM,
      });
      map = shownMap;
      const shownCircle = new naver.Circle({
        ...RADIUS_CIRCLE,
        map: shownMap,
        center: shownMap.getCenter(),
        radius: first?.radiusM ?? 500,
      });
      circle = shownCircle;
      shown.current = { map: shownMap, circle: shownCircle };
      listeners.push(
        naver.Event.addListener(shownMap, "center_changed", () =>
          ignoreSdkError(() => shownCircle.setCenter(shownMap.getCenter())),
        ),
        naver.Event.addListener(shownMap, "idle", () => {
          const now = shownMap.getCenter();
          setCenter(rounded(now.lat(), now.lng()));
        }),
      );
    } catch {
      closeBroken();
    }
    return () => {
      shown.current = undefined;
      ignoreSdkError(() => {
        listeners.forEach((listener) => naver.Event.removeListener(listener));
        circle?.setMap(null);
        map?.destroy();
      });
    };
  }, [naver]);

  // 반경을 바꾸면 원 전체가 지도에 들어오게 맞춘다. 처음 열 때도 같다
  useEffect(() => {
    const current = shown.current;
    if (!current) return;
    ignoreSdkError(() => {
      current.circle.setRadius(radiusM);
      current.map.fitBounds(current.circle.getBounds(), {
        top: FIT_MARGIN,
        right: FIT_MARGIN,
        bottom: FIT_MARGIN,
        left: FIT_MARGIN,
        maxZoom: FIT_MAX_ZOOM,
      });
    });
  }, [radiusM]);

  const locate = () => {
    setLocationFailed(false);
    if (!navigator.geolocation) {
      setLocationFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        ignoreSdkError(() =>
          shown.current?.map.panTo(
            new naver.LatLng(
              position.coords.latitude,
              position.coords.longitude,
            ),
          ),
        ),
      () => setLocationFailed(true),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const counted = check.isSuccess && !check.isFetching ? check.data : null;
  const name = ownName ?? check.data?.name ?? "";
  const empty = counted?.placeCount === 0;

  const pick = () => {
    const trimmed = name.trim();
    onPick({
      kind: "POINT",
      ...center,
      radiusM,
      ...(trimmed && { name: trimmed }),
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="지도에서 고르기"
      className="fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <TopBar
        start={
          <IconButton label="뒤로" onClick={onClose}>
            <ChevronLeftIcon className="text-icon" />
          </IconButton>
        }
        title="지도에서 고르기"
      />
      <div className="relative min-h-0 flex-1">
        {/* 지도 SDK가 지도 상자를 position: relative로 바꾸므로 자리는 감싸개가 정한다(D-34) */}
        <div className="absolute inset-0">
          <div
            ref={containerRef}
            data-testid="map-pick-map"
            className="size-full bg-surface-sunken"
          />
        </div>
        <p className="absolute inset-x-4 top-3 rounded-md bg-surface/90 px-3 py-2 text-center text-caption-md text-balance text-ink-muted">
          {locationFailed
            ? "위치를 찾지 못했어요. 지도를 움직여 맞춰 주세요."
            : "지도를 움직여 핀을 모일 곳에 맞춰 주세요"}
        </p>
        {/* 핀 끝이 지도 가운데에 오게 아이콘 높이만큼 위로 올린다 */}
        <PointPin
          name={name.trim()}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full"
        />
        <Fab
          label="내 위치"
          onClick={locate}
          className="absolute right-4 bottom-8"
        >
          <MyLocationIcon className="text-icon" />
        </Fab>
      </div>
      <section className="-mt-5 flex flex-col gap-3.5 rounded-t-xl bg-surface px-5 pt-5 pb-4 shadow-2">
        <div className="flex items-center justify-between gap-2">
          <span id={radioName} className="text-label-md">
            반경
          </span>
          <div
            role="group"
            aria-labelledby={radioName}
            className="flex flex-wrap justify-end gap-x-2"
          >
            {RADII.map((radius) => (
              <Chip
                key={radius}
                pressed={radiusM === radius}
                onPressedChange={(pressed) => pressed && setRadiusM(radius)}
              >
                {radiusLabel(radius)}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-label-md">
            위치 이름 <span className="font-normal text-ink-subtle">선택</span>
          </span>
          <TextField
            label="위치 이름"
            value={name}
            maxLength={POINT_NAME_MAX}
            onChange={(event) => setOwnName(event.target.value)}
            description="친구들에게 보일 이름이에요. 예: 회사 앞"
          />
        </div>
        {empty ? (
          <Note tone="warn">
            이 근처에는 아직 장소가 없어요. 지도를 옮기거나 반경을 넓혀 보세요.
          </Note>
        ) : check.isError ? (
          <Note tone="warn">
            장소 수를 세지 못했어요. 잠시 뒤 다시 시도해 주세요.
          </Note>
        ) : (
          <p aria-live="polite" className="text-caption-md text-ink-muted">
            {counted ? (
              <>
                반경 안에 장소가{" "}
                <span className="font-semibold text-ink">
                  {counted.placeCount}곳
                </span>{" "}
                있어요.
              </>
            ) : (
              "반경 안 장소를 세고 있어요"
            )}
          </p>
        )}
        <Button disabled={!counted || empty} onClick={pick}>
          이 위치로 정하기
        </Button>
      </section>
    </div>
  );
}
