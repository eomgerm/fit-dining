import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

// sticky + mt-auto: 내용이 짧으면 화면 맨 아래로 내려가고, 길면 스크롤해도 아래에 붙는다.
// 화면의 최상위 요소가 세로 flex여야 한다(Screen 또는 리뷰 ReviewFrame). 아래 safe area 여백도 여기서 넣는다
const bottomBarVariants = cva(
  "sticky bottom-0 mt-auto flex flex-col gap-2 px-5 pb-safe-4",
  {
    variants: {
      variant: {
        // Figma 'foot': 구분선 없이 위쪽이 투명에서 바탕색으로 번진다(28%부터 바탕색)
        fade: "bg-linear-to-b to-28% pt-4",
        // Figma 'rf-foot'·장소 상세 하단 막대: 흰 바탕과 위쪽 1px 구분선
        divider: "border-t border-line bg-surface pt-3",
      },
      // fade가 번지는 바탕색. 화면 바탕과 맞춘다
      tone: { surface: "", "surface-warm": "" },
    },
    compoundVariants: [
      { variant: "fade", tone: "surface", class: "from-surface/0 to-surface" },
      {
        variant: "fade",
        tone: "surface-warm",
        class: "from-surface-warm/0 to-surface-warm",
      },
    ],
    defaultVariants: { variant: "fade", tone: "surface" },
  },
);

type BottomBarProps = Omit<ComponentProps<"div">, "className"> &
  VariantProps<typeof bottomBarVariants> & {
    // 버튼들. 세로로 쌓인다(간격 8). 가로로 놓으려면 div로 감싼다
    children: ReactNode;
  };

// 화면 아래 고정 버튼 영역
export function BottomBar({ variant, tone, ...props }: BottomBarProps) {
  return <div className={bottomBarVariants({ variant, tone })} {...props} />;
}
