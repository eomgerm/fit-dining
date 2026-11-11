import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ClearIcon } from "@/shared/ui/icon/icons/clear";

type PickerFieldProps = {
  type: "date" | "time";
  // 화면 낭독기가 읽는 이름(예: "모임 날짜")
  label: string;
  // "2026-11-14" 또는 "19:00". 비었으면 빈 문자열
  value: string;
  // 고른 값을 보여 줄 글자(예: "11월 14일 (금)"). 값이 없으면 placeholder를 보인다
  display?: string;
  placeholder: string;
  icon: ReactNode;
  min?: string;
  max?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  // 있으면 값이 있을 때 오른쪽에 지우기 버튼을 둔다
  clearLabel?: string;
  className?: string;
};

// 기기의 날짜·시간 고르기를 여는 칸. 보이지 않는 기본 입력을 칸 위에 덮어 누르면 기기 고르기가 열리고,
// 칸에는 쓰는 쪽이 만든 글자("11월 14일 (금)", "저녁 7:00")를 보인다
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
  clearLabel,
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
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      {clearLabel && value && !disabled && (
        <IconButton
          label={clearLabel}
          className="relative -mr-2.5 size-9 text-icon-subtle"
          onClick={() => onChange("")}
        >
          <ClearIcon size="md" />
        </IconButton>
      )}
    </div>
  );
}
