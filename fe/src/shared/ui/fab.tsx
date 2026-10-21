import { Button as BaseButton } from "@base-ui/react/button";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/cn";

type FabProps = Omit<BaseButton.Props, "className" | "children"> & {
  // 아이콘만 있는 버튼이라 화면 낭독기가 읽을 이름이 꼭 필요하다
  label: string;
  // 아이콘 하나. Figma에서는 24px(기본 크기)이고, 꺼진 상태만 text-ink-muted다
  children: ReactElement;
  // 위치는 부모가 정한다(예: absolute right-4 bottom-4)
  className?: string;
};

// Figma 'FAB'. 지도·사진 위에 뜨는 흰 44px 원형 버튼
export function Fab({ label, className, ...props }: FabProps) {
  return (
    <BaseButton
      aria-label={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface shadow-2 transition select-none data-disabled:pointer-events-none motion-safe:active:scale-94",
        className,
      )}
      {...props}
    />
  );
}
