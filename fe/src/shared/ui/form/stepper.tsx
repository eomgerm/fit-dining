import { Button as BaseButton } from "@base-ui/react/button";

import { cn } from "@/shared/lib/cn";

type StepperProps = {
  // 화면 낭독기가 읽는 이름(예: "인원")
  label: string;
  // 정하지 않았으면 null이다
  value: number | null;
  // 값을 화면 글자로(예: 4 → "4명", null → "정하지 않음")
  format: (value: number | null) => string;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  previousLabel: string;
  nextLabel: string;
  className?: string;
};

// 모임 인원처럼 값을 하나씩 바꾸는 스테퍼(모임 화면 예시 모임장 3). 다음·이전 값은 쓰는 쪽이 정해 "정하지 않음" 같은
// 값 없는 상태를 둘 수 있다
export function Stepper({
  label,
  value,
  format,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  previousLabel,
  nextLabel,
  className,
}: StepperProps) {
  const step =
    "inline-flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-title-lg font-normal text-icon transition select-none data-disabled:text-ink-disabled motion-safe:active:scale-94";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-center gap-1", className)}
    >
      <BaseButton
        className={step}
        aria-label={previousLabel}
        disabled={!canPrevious}
        onClick={onPrevious}
      >
        −
      </BaseButton>
      <output
        aria-live="polite"
        className={cn(
          "min-w-11 px-1 text-center",
          value === null ? "text-body-sm text-ink-muted" : "text-title-md",
        )}
      >
        {format(value)}
      </output>
      <BaseButton
        className={step}
        aria-label={nextLabel}
        disabled={!canNext}
        onClick={onNext}
      >
        +
      </BaseButton>
    </div>
  );
}
