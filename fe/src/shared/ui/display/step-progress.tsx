import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/cn";

type StepProgressProps = Omit<ComponentProps<"div">, "className"> & {
  // 현재 단계(1부터)
  step: number;
  total: number;
  // 화면 낭독기가 읽는 진행 막대 이름(예: "온보딩 진행", "방문 평가 진행")
  label: string;
  // 폭·배치. Figma는 w-64(256px)
  className?: string;
};

// Figma 'Onboarding progress'(4단계)·'Review progress'(2단계). 지나온 단계까지 주황으로 칠한 막대
export function StepProgress({
  step,
  total,
  label,
  className,
  ...props
}: StepProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={step}
      aria-valuetext={`${step}/${total}단계`}
      className={cn("flex gap-1", className)}
      {...props}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            index < step ? "bg-primary" : "bg-line",
          )}
        />
      ))}
    </div>
  );
}
