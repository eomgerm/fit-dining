// 움직임 줄이기 설정. CSS motion-reduce:가 닿지 않는 JS 스크롤·넘김에서 부를 때마다 읽는다
export function prefersReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
