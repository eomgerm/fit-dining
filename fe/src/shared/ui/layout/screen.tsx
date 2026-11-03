import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

import { StatusBarColor } from "./status-bar-color";

// 폭은 모바일 화면(440px)까지, 높이는 화면 전체. 아래 고정 버튼은 BottomBar를 마지막 자식으로 둔다
const screenVariants = cva(
  "mx-auto flex min-h-viewport w-full max-w-110 flex-col pt-safe-0",
  {
    variants: {
      tone: {
        surface: "bg-surface",
        "surface-warm": "bg-surface-warm",
        secondary: "bg-secondary",
        // 위치 권한(Figma Location): 위쪽이 주황빛으로 번진다
        glow: "bg-linear-to-b from-primary-soft via-surface-warm to-surface",
      },
      // 로그인·가입·위치 권한처럼 내용을 화면 가장자리에서 띄우는 폼 화면
      inset: { none: "", page: "px-5 sm:px-8" },
      // 아래 끝 여백. BottomBar가 있거나 아래 고정 요소가 없는 화면은 none이다.
      // 여기서 넣고 BottomBar도 두면 스크롤 끝에서 BottomBar가 인디케이터 높이만큼 떠 보인다
      bottom: { none: "", sm: "pb-safe-4", md: "pb-safe-6" },
    },
    defaultVariants: { tone: "surface", inset: "none", bottom: "none" },
  },
);

type ScreenProps = VariantProps<typeof screenVariants> & {
  // relative처럼 자식 배치를 위한 클래스만
  className?: string;
  children: ReactNode;
};

// 페이지 단위로 스크롤하는 화면의 바탕. 홈 화면 앱의 상태바도 화면 바탕색으로 칠한다
export function Screen({ className, children, ...variants }: ScreenProps) {
  return (
    <main className={cn(screenVariants(variants), className)}>
      <StatusBarColor tone={variants.tone} />
      {children}
    </main>
  );
}
