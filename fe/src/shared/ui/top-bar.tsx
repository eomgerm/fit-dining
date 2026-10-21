import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

const topBarVariants = cva("relative flex h-14 items-center gap-3 px-2", {
  variants: {
    tone: {
      transparent: "",
      // 방문 평가·리뷰 수정처럼 내용이 아래로 스크롤되는 화면
      surface: "bg-surface",
    },
  },
  defaultVariants: { tone: "transparent" },
});

type TopBarProps = Omit<ComponentProps<"header">, "className" | "title"> &
  VariantProps<typeof topBarVariants> & {
    // 왼쪽 칸(예: <IconButton label="뒤로"><ChevronLeftIcon /></IconButton>)
    start?: ReactNode;
    // 칸 배치와 관계없이 화면 정가운데에 놓는 제목
    title?: ReactNode;
    // 가운데 칸을 채우는 내용(예: <StepProgress step={2} total={4} />)
    children?: ReactNode;
    // 오른쪽 칸(예: <TopBarAction>건너뛰기</TopBarAction>, 닫기 IconButton)
    end?: ReactNode;
    // sticky 같은 배치
    className?: string;
  };

// Figma 화면 상단 'top'. 왼쪽·오른쪽 칸은 비어도 44px를 차지해 가운데 칸 폭이 화면마다 같다
export function TopBar({
  start,
  title,
  children,
  end,
  tone,
  className,
  ...props
}: TopBarProps) {
  return (
    <header className={cn(topBarVariants({ tone }), className)} {...props}>
      <div className="flex min-w-11 shrink-0">{start}</div>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      <div className="flex min-w-11 shrink-0 justify-end">{end}</div>
      {title && (
        <h1 className="pointer-events-none absolute inset-0 flex items-center justify-center px-20 text-title-sm text-ink">
          <span className="truncate">{title}</span>
        </h1>
      )}
    </header>
  );
}

// TopBar 오른쪽의 "건너뛰기" 같은 글자 버튼. TextButton과 달리 밑줄 없이 회색이다
export function TopBarAction(props: Omit<BaseButton.Props, "className">) {
  return (
    <BaseButton
      className="flex h-11 min-w-18 items-center justify-center px-2 text-label-md text-ink-muted transition select-none data-disabled:pointer-events-none motion-safe:active:scale-98"
      {...props}
    />
  );
}
