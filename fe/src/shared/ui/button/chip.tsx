import { Toggle } from "@base-ui/react/toggle";

import { cn } from "@/shared/lib/cn";
import { CheckIcon } from "@/shared/ui/icon/icons/check";

type ChipProps = Omit<Toggle.Props, "className"> & {
  className?: string;
};

// Figma 'Chip'. 눌러서 고르는 칩. 여러 칩 중 몇 개를 고를지는 쓰는 쪽에서 pressed로 관리한다
export function Chip({ className, children, ...props }: ChipProps) {
  return (
    <Toggle
      className={cn(
        "group inline-flex h-11 items-center gap-1 rounded-sm border border-line-strong bg-surface px-4 text-body-md whitespace-nowrap text-ink transition-colors duration-200 select-none data-disabled:pointer-events-none data-pressed:border-1.5 data-pressed:border-primary data-pressed:bg-primary-soft data-pressed:pl-3 data-pressed:font-semibold data-pressed:text-primary-strong",
        className,
      )}
      {...props}
    >
      <CheckIcon
        size="md"
        className="hidden group-data-pressed:block motion-safe:group-data-pressed:animate-draw-in"
      />
      {children}
    </Toggle>
  );
}
