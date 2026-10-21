import { Radio as BaseRadio } from "@base-ui/react/radio";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type RadioProps = Omit<BaseRadio.Root.Props, "className" | "children"> & {
  // 원 옆 글자. label로 감싸 글자를 눌러도 선택된다
  children: ReactNode;
  className?: string;
};

// Figma 'Radio row'. 여러 개 중 하나를 고르므로 Base UI RadioGroup 안에 둔다
export function Radio({ children, className, ...props }: RadioProps) {
  return (
    <label
      className={cn(
        "flex h-11 items-center gap-2.5 text-body-md text-ink",
        className,
      )}
    >
      <BaseRadio.Root
        className="flex size-5 shrink-0 items-center justify-center rounded-full border-1.5 border-ink-subtle bg-surface transition-colors data-checked:border-primary data-checked:bg-primary"
        {...props}
      >
        <BaseRadio.Indicator className="size-2 rounded-full bg-on-primary" />
      </BaseRadio.Root>
      {children}
    </label>
  );
}
