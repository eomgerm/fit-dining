import type { ReactNode, Ref } from "react";

import { cn } from "@/shared/lib/cn";

// 리뷰 작성·수정 화면의 바탕. 높이를 뷰포트에 맞추고 가운데(children)만 스크롤해 스크롤 막대가 움직이는 범위와 같다.
// 아래 끝 여백은 footer(BottomBar)가 맡는다
export function ReviewFrame({
  top,
  sunken,
  pinned,
  footer,
  scrollRef,
  children,
}: {
  // 상단 막대. 상태바 자리까지 채우도록 TopBar tone="surface" safeTop을 쓴다
  top: ReactNode;
  // 7-01·7-02: 장소·방문일 줄 아래(질문과 태그 목록)를 회색 띠로 깐다
  sunken?: boolean;
  // 상단 막대 아래에서 스크롤하지 않는 내용(7-01·7-02의 장소·방문일 줄과 질문)
  pinned?: ReactNode;
  footer?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex h-dvh w-full max-w-110 flex-col",
        sunken ? "bg-surface-sunken" : "bg-surface",
      )}
    >
      <div className="shrink-0">
        {top}
        {pinned}
      </div>
      <div
        ref={scrollRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {children}
      </div>
      {footer}
    </div>
  );
}
