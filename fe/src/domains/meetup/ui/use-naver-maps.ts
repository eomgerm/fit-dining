"use client";

import { useEffect, useState } from "react";

import {
  loadNaverMaps,
  naverAuthFailed,
  onNaverAuthFailure,
  type NaverMaps,
} from "@/shared/lib/naver-maps";
import { loadRuntimeConfig } from "@/shared/lib/runtime-config";

export type NaverMapsState =
  | { status: "loading" }
  | { status: "ready"; naver: NaverMaps }
  | { status: "failed" };

// 모임 화면의 네이버 지도 SDK. 키가 없거나 스크립트를 받지 못하거나 인증에 실패하면 failed다. 그때는 지도로 고르기를
// 숨기고 지도 보기에는 안내만 보인다(AC-60)
export function useNaverMaps(): NaverMapsState {
  const [state, setState] = useState<NaverMapsState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setState({ status: "failed" });
    };
    const stop = onNaverAuthFailure(fail);
    loadRuntimeConfig()
      .then((config) => {
        if (!config?.naverMapClientId) throw new Error("지도 키가 없습니다");
        return loadNaverMaps(config.naverMapClientId);
      })
      .then((naver) => {
        if (cancelled) return;
        if (naverAuthFailed()) throw new Error("지도 인증에 실패했습니다");
        setState({ status: "ready", naver });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return state;
}

// 반경 원의 모양. 화면 예시(모임장 4)의 주황 원이다
export const RADIUS_CIRCLE = {
  strokeColor: "#f2622e",
  strokeOpacity: 0.55,
  strokeWeight: 2,
  fillColor: "#f2622e",
  fillOpacity: 0.12,
  clickable: false,
};
