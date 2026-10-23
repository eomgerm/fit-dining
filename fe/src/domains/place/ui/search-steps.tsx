"use client";

import { useEffect, useState } from "react";

// 실제 진행 단계가 아니라 기다리는 동안 차례로 보이는 안내다(와이어프레임 Loading)
export const SEARCH_STEPS = [
  "요청을 이해하는 중",
  "주변 장소를 찾는 중",
  "취향과 맞춰 보는 중",
];

export const SEARCH_STEP_MS = 1500;

// 깜빡이는 점과 단계 문구. 동작 줄이기 설정이면 점이 깜빡이지 않고 문구만 바뀐다
export function SearchSteps() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setStep((current) => (current + 1) % SEARCH_STEPS.length),
      SEARCH_STEP_MS,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-body-sm text-ink-muted"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
      />
      {SEARCH_STEPS[step]}
    </p>
  );
}
