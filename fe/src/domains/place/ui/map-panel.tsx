import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

// 중간(5-04), 전체(5-05), 요청 기록 펼침(와이어프레임 RequestHistory)
export type PanelState = "middle" | "full" | "history";

// 지도 위 하단 패널(결과, 과거 결과, 저장한 장소). 모션 메모: 높이가 바뀔 때 320ms.
// 아래 끝 여백은 패널 안에서 끝에 닿는 요소가 pb-safe-*로 맡는다
export function MapPanel({
  state,
  label,
  edge,
  children,
}: {
  // middle: 화면 60%, full: 화면 전체(상태바 아래부터 내용), history: 지도 위 버튼 아래까지
  state: PanelState;
  // 화면 낭독기가 읽는 패널 이름
  label: string;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치"). 중간 높이에서만 보인다
  edge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "absolute inset-x-0 bottom-0 flex flex-col bg-surface shadow-sheet transition-all duration-320 ease-enter",
        state === "full" && "h-full pt-safe-0",
        state === "middle" && "h-3/5 rounded-t-xl",
        // 지도 위 버튼(저장한 장소, 내 정보) 아래까지 펼친다
        state === "history" && "top-safe-30 rounded-t-xl",
      )}
    >
      {state === "middle" && edge && (
        <div className="absolute right-4 bottom-full mb-3">{edge}</div>
      )}
      {children}
    </section>
  );
}
