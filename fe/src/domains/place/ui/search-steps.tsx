"use client";

import { useEffect, useState } from "react";

import { TextButton } from "@/shared/ui/button/text-button";

// 실제 진행 단계가 아니라 기다리는 동안 차례로 보이는 안내다(와이어프레임 Loading)
export const SEARCH_STEPS = [
  "요청을 이해하는 중",
  "주변 장소를 찾는 중",
  "취향과 맞춰 보는 중",
];

export const SEARCH_STEP_MS = 1500;

// 이만큼 지나도 결과가 없으면 단계 문구 대신 "조금만 더 걸려요"와 "검색 취소"를 보인다(5-E02)
export const SEARCH_SLOW_MS = 3000;

// 깜빡이는 점과 단계 문구. 동작 줄이기 설정이면 점이 깜빡이지 않고 문구만 바뀐다.
// onCancel이 없으면 오래 걸려도 단계 문구만 이어 간다
export function SearchSteps({ onCancel }: { onCancel?: () => void }) {
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setInterval(
      () => setStep((current) => (current + 1) % SEARCH_STEPS.length),
      SEARCH_STEP_MS,
    );
    const slowTimer = setTimeout(() => setSlow(true), SEARCH_SLOW_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(slowTimer);
    };
  }, []);

  const showSlow = slow && onCancel;
  return (
    <div className="flex items-center justify-between gap-2">
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-body-sm text-ink-muted"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse"
        />
        {showSlow ? "조금만 더 걸려요" : SEARCH_STEPS[step]}
      </p>
      {showSlow && (
        <TextButton variant="muted" onClick={onCancel}>
          검색 취소
        </TextButton>
      )}
    </div>
  );
}
