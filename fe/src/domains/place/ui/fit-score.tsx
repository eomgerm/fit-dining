import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";

const scoreVariants = cva("text-primary", {
  variants: {
    // md는 카드의 20/28, lg는 상세의 30/40
    size: { md: "text-title-lg", lg: "text-headline-lg" },
  },
  defaultVariants: { size: "md" },
});

type FitScoreProps = VariantProps<typeof scoreVariants> & {
  // 0~100 정수. % 없이 그대로 보인다
  score: number;
  className?: string;
};

// 카드 오른쪽과 상세의 "84 핏 점수"
export function FitScore({ score, size, className }: FitScoreProps) {
  return (
    <div className={cn("flex flex-col items-end", className)}>
      <span className={scoreVariants({ size })}>{score}</span>
      <span className="text-caption-sm text-ink-muted">핏 점수</span>
    </div>
  );
}
