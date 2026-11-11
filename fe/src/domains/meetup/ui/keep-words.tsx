import type { ReactNode } from "react";

// 확인 창은 화면 밖(포털)에 그려져 모임 화면 최상위의 한글 줄바꿈 규칙이 닿지 않는다. 창 문구도 단어 단위로 줄을 바꾼다
export function KeepWords({ children }: { children: ReactNode }) {
  return <span className="break-keep">{children}</span>;
}
