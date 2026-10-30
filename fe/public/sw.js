// 서비스 워커 자리만 잡는다. fetch 핸들러가 없어서 모든 요청은 지금처럼 네트워크로 간다.
// 푸시·오프라인이 필요해지면 여기에 핸들러를 더한다. /api·사진·/config.json은 캐시하지 않는다(design.md 12.5 #4)
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
