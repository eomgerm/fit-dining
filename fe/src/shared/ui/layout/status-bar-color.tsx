import { cva, type VariantProps } from "class-variance-authority";

const statusBarColor = cva(
  // 배경색은 선언만 하고 칠하지 않는다(bg-clip-text). 화면에는 아무것도 보이지 않는다
  "pointer-events-none fixed inset-x-0 top-0 z-20 h-3 bg-clip-text",
  {
    variants: {
      tone: {
        surface: "bg-surface",
        "surface-warm": "bg-surface-warm",
        secondary: "bg-secondary",
        // 위치 권한 화면 그라데이션의 맨 위 색
        glow: "bg-primary-soft",
      },
    },
    defaultVariants: { tone: "surface" },
  },
);

// 홈 화면 앱의 상태바 색. iOS 27은 상단 가장자리에 고정된 넓은 요소(폭 90% 이상, 10px 초과)가 있으면
// 그 background-color로 상태바를 칠하고, 없으면 상단을 시스템 블러로 덮는다(WebKit LocalFrameView::fixedContainerEdges).
// 색은 칠한 픽셀이 아니라 스타일에서 읽으므로 칠하지 않아도 된다. 화면마다 하나 둔다
export function StatusBarColor(props: VariantProps<typeof statusBarColor>) {
  return <div aria-hidden className={statusBarColor(props)} />;
}
