import { Switch as BaseSwitch } from "@base-ui/react/switch";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type SwitchProps = Omit<BaseSwitch.Root.Props, "className" | "children"> & {
  // 스위치 왼쪽 글자. label로 감싸 글자를 눌러도 바뀐다
  label: ReactNode;
  // 글자 아래 설명
  description?: ReactNode;
  className?: string;
};

// 켜고 끄는 설정 한 줄(모임 투표 열기의 익명 투표). 모션 메모: 손잡이와 바탕색이 200ms로 바뀐다
export function Switch({
  label,
  description,
  className,
  ...props
}: SwitchProps) {
  return (
    <label className={cn("flex items-start gap-3", className)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-title-sm text-ink">{label}</span>
        {description && (
          <span className="text-caption-md text-ink-muted">{description}</span>
        )}
      </span>
      <BaseSwitch.Root
        className="flex h-7 w-12 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-200 data-checked:bg-primary motion-reduce:duration-120"
        {...props}
      >
        <BaseSwitch.Thumb className="size-6 rounded-full bg-surface shadow-1 transition-transform duration-200 data-checked:translate-x-5 motion-reduce:duration-120" />
      </BaseSwitch.Root>
    </label>
  );
}
