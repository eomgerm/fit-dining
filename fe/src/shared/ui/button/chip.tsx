import { Toggle } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";
import { CheckIcon } from "@/shared/ui/icon/icons/check";

// 위아래 4px 여백은 36px 칩의 줄 간격을 터치 최소 크기(44px)로 맞춘다
const chipVariants = cva(
  "group my-1 inline-flex items-center rounded-sm border border-line-strong bg-surface whitespace-nowrap text-ink transition-colors duration-200 select-none data-disabled:pointer-events-none data-disabled:text-ink-disabled data-pressed:border-1.5 data-pressed:border-primary data-pressed:bg-primary-soft data-pressed:font-semibold data-pressed:text-primary-strong motion-reduce:duration-120",
  {
    variants: {
      size: {
        md: "h-9 px-3 text-body-sm data-pressed:text-label-md",
        lg: "h-11 px-4 text-body-md",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ChipProps = Omit<Toggle.Props, "className"> &
  VariantProps<typeof chipVariants> & {
    className?: string;
  };

// fit.css '.fd-chip'. 눌러서 고르는 칩. 여러 칩 중 몇 개를 고를지는 쓰는 쪽에서 pressed로 관리한다.
// 체크 자리(체크 20px + 간격 4px)가 200ms 동안 벌어지고 닫혀 옆 칩이 툭 밀리지 않고 미끄러진다.
// 움직임 줄이기에서는 자리가 바로 바뀌고 체크는 투명도만 120ms로 바뀐다
export function Chip({ size, className, children, ...props }: ChipProps) {
  return (
    <Toggle className={cn(chipVariants({ size }), className)} {...props}>
      <span
        className={cn(
          "flex w-0 shrink-0 overflow-hidden transition-all duration-200 group-data-pressed:w-6 motion-reduce:transition-none",
          // 체크 그림이 아이콘 상자 안 4px에서 시작하므로 lg는 그만큼 왼쪽으로 당긴다(눌린 칩의 왼쪽 여백 12px)
          size === "lg" && "group-data-pressed:-ml-1",
        )}
      >
        <CheckIcon
          size="md"
          className="opacity-0 transition-opacity duration-200 group-data-pressed:opacity-100 motion-safe:group-data-pressed:animate-draw-in motion-reduce:duration-120"
        />
      </span>
      {children}
    </Toggle>
  );
}
