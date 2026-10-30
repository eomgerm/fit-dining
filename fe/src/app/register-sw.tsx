"use client";

import { useEffect } from "react";

// 개발 서버에서는 등록하지 않는다. 한 번 등록된 워커가 남아 로컬 동작을 헷갈리게 만든다
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    // 워커 파일을 HTTP 캐시 없이 받아 배포가 바로 반영되게 한다(Next PWA 가이드)
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => console.error("서비스 워커 등록 실패", error));
  }, []);
  return null;
}
