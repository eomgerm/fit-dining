import { Toggle } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";
import { CheckIcon } from "@/shared/ui/icon/icons/check";

// 위아래 4px 여백은 36px 칩의 줄 간격을 터치 최소 크기(44px)로 맞춘다
const chipVariants = cva(
  "group my-1 inline-flex items-center gap-1 rounded-sm border border-line-strong bg-surface whitespace-nowrap text-ink transition-colors duration-200 select-none data-disabled:pointer-events-none data-disabled:text-ink-disabled data-pressed:border-1.5 data-pressed:border-primary data-pressed:bg-primary-soft data-pressed:font-semibold data-pressed:text-primary-strong",
  {
    variants: {
      size: {
        md: "h-9 px-3 text-body-sm data-pressed:text-label-md",
        // 체크 그림이 아이콘 상자 안 4px에서 시작하므로 눌리면 왼쪽 여백을 그만큼 줄인다
        lg: "h-11 px-4 text-body-md data-pressed:pl-3",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ChipProps = Omit<Toggle.Props, "className"> &
  VariantProps<typeof chipVariants> & {
    className?: string;
  };

// fit.css '.fd-chip'. 눌러서 고르는 칩. 여러 칩 중 몇 개를 고를지는 쓰는 쪽에서 pressed로 관리한다
export function Chip({ size, className, children, ...props }: ChipProps) {
  return (
    <Toggle className={cn(chipVariants({ size }), className)} {...props}>
      <CheckIcon
        size="md"
        className="hidden group-data-pressed:block motion-safe:group-data-pressed:animate-draw-in"
      />
      {children}
    </Toggle>
  );
}
