import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type PickerFieldProps = {
  type: "date" | "time";
  // 화면 낭독기가 읽는 이름(예: "모임 날짜")
  label: string;
  // "2026-11-14" 또는 "19:00". 비었으면 빈 문자열
  value: string;
  // 고른 값을 보여 줄 글자(예: "11월 14일 (토)"). 값이 없으면 placeholder를 보인다
  display?: string;
  placeholder: string;
  icon: ReactNode;
  min?: string;
  max?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  className?: string;
};

// 기기의 날짜·시간 고르기를 여는 칸. 보이지 않는 기본 입력을 칸 위에 덮어 누르면 기기 고르기가 열리고,
// 칸에는 쓰는 쪽이 만든 글자("11월 14일 (토)", "저녁 7:00")를 보인다.
// 데스크톱 크롬은 입력 오른쪽의 달력 아이콘을 눌러야만 고르기를 열어, 칸 어디를 눌러도 열리게 showPicker를 부른다
function openPicker(input: HTMLInputElement) {
  try {
    input.showPicker?.();
  } catch {
    // 지원하지 않거나 막힌 브라우저는 기본 동작을 그대로 둔다
  }
}

export function PickerField({
  type,
  label,
  value,
  display,
  placeholder,
  icon,
  min,
  max,
  disabled,
  onChange,
  className,
}: PickerFieldProps) {
  return (
    <div
      className={cn(
        "relative flex h-13 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 focus-within:border-1.5 focus-within:border-primary-strong",
        disabled && "bg-surface-sunken",
        className,
      )}
    >
      <span className="flex shrink-0 text-icon-subtle" aria-hidden="true">
        {icon}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body-md",
          value ? "text-ink" : "text-ink-subtle",
        )}
        aria-hidden="true"
      >
        {value ? (display ?? value) : placeholder}
      </span>
      <input
        type={type}
        aria-label={label}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => openPicker(event.currentTarget)}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      />
    </div>
  );
}
