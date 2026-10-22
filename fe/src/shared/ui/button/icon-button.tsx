import { Button as BaseButton } from "@base-ui/react/button";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/cn";

type IconButtonProps = Omit<BaseButton.Props, "className" | "children"> & {
  // 아이콘만 있는 버튼이라 화면 낭독기가 읽을 이름이 꼭 필요하다
  label: string;
  // 아이콘 하나. 크기·색은 아이콘에서 정한다(예: <MoreIcon size="md" className="text-ink-muted" />)
  children: ReactElement;
  className?: string;
};

// Figma 'Icon button'. 바탕 없는 44px 원형 터치 영역
export function IconButton({ label, className, ...props }: IconButtonProps) {
  return (
    <BaseButton
      aria-label={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition select-none data-disabled:pointer-events-none motion-safe:active:scale-94",
        className,
      )}
      {...props}
    />
  );
}
