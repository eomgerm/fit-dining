import { Field } from "@base-ui/react/field";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type TextFieldProps = Omit<Field.Control.Props, "className"> & {
  // Figma처럼 화면에는 숨기고 화면 낭독기만 읽는다. placeholder는 입력을 시작하면 사라지기 때문이다
  label: string;
  // 입력칸 아래 회색 도움말
  description?: ReactNode;
  // 있으면 빨간 테두리와 문구를 보여 준다. 도움말 대신 보인다
  error?: ReactNode;
  // 별도로 표시한 오류 문구를 중복하지 않고 오류 테두리만 적용한다
  invalid?: boolean;
  // 오른쪽 끝 단위(예: 원)
  suffix?: ReactNode;
  className?: string;
};

// Figma 'Text field'. 라벨·도움말·오류 문구는 Base UI Field가 aria로 입력칸에 연결한다
export function TextField({
  label,
  description,
  error,
  invalid,
  suffix,
  className,
  ...props
}: TextFieldProps) {
  const isInvalid = invalid ?? (error ? true : undefined);
  return (
    <Field.Root
      invalid={isInvalid}
      className={cn("flex flex-col gap-2", className)}
    >
      <Field.Label className="sr-only">{label}</Field.Label>
      {/* 포커스는 안쪽 1.5px 주황 테두리. 오류면 포커스 중에도 빨강 테두리를 유지한다 */}
      <div
        className={cn(
          "flex h-13 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5",
          isInvalid
            ? "border-1.5 border-danger"
            : "focus-within:border-1.5 focus-within:border-primary-strong",
        )}
      >
        <Field.Control
          className="min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-subtle"
          {...props}
        />
        {suffix && <span className="text-body-md text-ink">{suffix}</span>}
      </div>
      {error ? (
        <Field.Error match className="text-caption-md text-danger">
          {error}
        </Field.Error>
      ) : (
        description && (
          <Field.Description className="text-caption-md text-ink-muted">
            {description}
          </Field.Description>
        )
      )}
    </Field.Root>
  );
}
