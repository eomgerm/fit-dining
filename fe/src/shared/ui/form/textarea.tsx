"use client";

import { Field } from "@base-ui/react/field";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/shared/lib/cn";

type TextareaProps = Omit<Field.Control.Props, "className"> & {
  // Figma처럼 화면에는 숨기고 화면 낭독기만 읽는다
  label: string;
  // 있으면 오른쪽 아래에 "44/500"처럼 글자 수를 보여 준다
  maxLength?: number;
  className?: string;
  trailingAction?: ReactNode;
  footerAction?: ReactNode;
  // 기본 리뷰 입력칸은 그대로 두고, 취향 입력에만 조건부 강조를 적용한다.
  emphasis?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
};

// Figma 'Textarea'. 리뷰처럼 여러 줄을 쓰는 높이 140 고정 입력칸
export function Textarea({
  label,
  maxLength,
  className,
  value,
  defaultValue,
  onValueChange,
  trailingAction,
  footerAction,
  emphasis,
  inputRef,
  ...props
}: TextareaProps) {
  const [length, setLength] = useState(String(defaultValue ?? "").length);
  const count = value === undefined ? length : String(value).length;
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(inputRef, () => ref.current!, []);

  // 폼을 reset하면 change 이벤트 없이 값만 돌아가므로 글자 수를 다시 센다
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const handleReset = () =>
      setTimeout(() => setLength(ref.current?.value.length ?? 0));
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, []);

  return (
    <Field.Root className={className}>
      <Field.Label className="sr-only">{label}</Field.Label>
      <div
        className={cn(
          "relative flex h-35 flex-col gap-1 rounded-md border border-line-strong bg-surface p-3",
          emphasis === undefined
            ? "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring"
            : "focus-within:border-1.5 focus-within:border-primary-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring",
          emphasis && "border-1.5 border-primary-strong",
          props["aria-invalid"] && "border-danger",
          props["aria-invalid"] &&
            emphasis !== undefined &&
            "border-1.5 focus-within:border-danger",
        )}
      >
        <Field.Control
          render={<textarea ref={ref} />}
          value={value}
          defaultValue={defaultValue}
          maxLength={maxLength}
          onValueChange={(next, details) => {
            setLength(next.length);
            onValueChange?.(next, details);
          }}
          className={cn(
            "min-h-0 flex-1 resize-none bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle",
            trailingAction && "pr-8",
          )}
          {...props}
        />
        {trailingAction && (
          <div className="absolute top-0 right-0">{trailingAction}</div>
        )}
        {maxLength !== undefined && (
          <div className="flex shrink-0 items-center justify-between gap-2">
            <Field.Description
              className={cn(
                "text-caption-sm text-ink-muted",
                !footerAction && "ml-auto",
              )}
            >
              {count}/{maxLength}
            </Field.Description>
            {footerAction}
          </div>
        )}
      </div>
    </Field.Root>
  );
}
