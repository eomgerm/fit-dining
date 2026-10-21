"use client";

import { Field } from "@base-ui/react/field";
import { useState } from "react";

type TextareaProps = Omit<Field.Control.Props, "className"> & {
  // Figma처럼 화면에는 숨기고 화면 낭독기만 읽는다
  label: string;
  // 있으면 오른쪽 아래에 "44/500"처럼 글자 수를 보여 준다
  maxLength?: number;
  className?: string;
};

// Figma 'Textarea'. 리뷰처럼 여러 줄을 쓰는 높이 140 고정 입력칸
export function Textarea({
  label,
  maxLength,
  className,
  value,
  defaultValue,
  onValueChange,
  ...props
}: TextareaProps) {
  const [length, setLength] = useState(String(defaultValue ?? "").length);
  const count = value === undefined ? length : String(value).length;

  return (
    <Field.Root className={className}>
      <Field.Label className="sr-only">{label}</Field.Label>
      <div className="flex h-35 flex-col gap-1 rounded-md border border-line-strong bg-surface p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
        <Field.Control
          render={<textarea />}
          value={value}
          defaultValue={defaultValue}
          maxLength={maxLength}
          onValueChange={(next, details) => {
            setLength(next.length);
            onValueChange?.(next, details);
          }}
          className="h-24 resize-none bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
          {...props}
        />
        {maxLength !== undefined && (
          <Field.Description className="self-end text-caption-sm text-ink-muted">
            {count}/{maxLength}
          </Field.Description>
        )}
      </div>
    </Field.Root>
  );
}
