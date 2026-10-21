import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { CheckIcon } from "@/shared/ui/icons/check";

type CheckboxProps = Omit<BaseCheckbox.Root.Props, "className" | "children"> & {
  // 상자 옆 글자. label로 감싸 글자를 눌러도 선택된다
  children: ReactNode;
  className?: string;
};

// Figma 'Checkbox row'. "전체 동의"처럼 묶을 때는 Base UI CheckboxGroup으로 감싼다
export function Checkbox({ children, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex h-11 items-center gap-2.5 text-body-md text-ink",
        className,
      )}
    >
      <BaseCheckbox.Root
        className="flex size-5 shrink-0 items-center justify-center rounded-checkbox border-1.5 border-ink-subtle bg-surface transition-colors data-checked:border-primary data-checked:bg-primary"
        {...props}
      >
        <BaseCheckbox.Indicator className="text-on-primary">
          <CheckIcon className="size-3.5" />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {children}
    </label>
  );
}
