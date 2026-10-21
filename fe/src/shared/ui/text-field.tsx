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
  // 오른쪽 끝 단위(예: 원)
  suffix?: ReactNode;
  className?: string;
};

// Figma 'Text field'. 라벨·도움말·오류 문구는 Base UI Field가 aria로 입력칸에 연결한다
export function TextField({
  label,
  description,
  error,
  suffix,
  className,
  ...props
}: TextFieldProps) {
  return (
    <Field.Root
      invalid={error ? true : undefined}
      className={cn("group flex flex-col gap-2", className)}
    >
      <Field.Label className="sr-only">{label}</Field.Label>
      <div className="flex h-13 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 group-data-invalid:border-1.5 group-data-invalid:border-danger focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
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
