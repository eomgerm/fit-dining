// 서비스 워커 자리만 잡는다. 핸들러가 없어서 모든 요청은 지금처럼 네트워크로 간다.
// 푸시·오프라인이 필요해지면 여기에 핸들러를 더한다. /api·사진·/config.json은 캐시하지 않는다(design.md 12.5 #4)
// - 새 워커의 활성화 정책(skipWaiting·clients.claim)은 fetch 핸들러를 붙일 때 함께 정한다
// - 이 파일의 CSP(next.config.ts)는 default-src 'self'라서 워커 안의 다른 출처 fetch는 막힌다. 지도·분석 요청을 넘길 때 connect-src를 연다
// - 이 파일은 지우지 않는다. 지우면 업데이트 확인이 404로 실패해 옛 워커가 남는다. 되돌릴 때는 핸들러를 빼거나 self.registration.unregister()를 넣어 배포한다
