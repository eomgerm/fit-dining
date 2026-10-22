import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/shared/lib/cn";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

// Figma 'Note'. 화면 안에 계속 보이는 짧은 안내 상자
const noteVariants = cva(
  "flex items-start gap-2 rounded-md px-3.5 py-3 text-caption-md",
  {
    variants: {
      tone: {
        muted: "bg-surface-sunken text-ink-muted",
        warn: "bg-warning-soft text-warning",
        ok: "bg-success-soft text-success",
      },
    },
    defaultVariants: { tone: "muted" },
  },
);

// 상태색은 아이콘과 함께 쓰는 것이 토큰 규칙이라 tone마다 아이콘을 고정한다
const toneIcons = {
  muted: <InfoIcon size="sm" className="mt-px" />,
  warn: <WarningIcon size="md" />,
  ok: <CheckIcon size="md" />,
};

type NoteProps = Omit<ComponentProps<"div">, "className"> &
  VariantProps<typeof noteVariants> & {
    className?: string;
  };

export function Note({ tone, className, children, ...props }: NoteProps) {
  return (
    <div className={cn(noteVariants({ tone }), className)} {...props}>
      {toneIcons[tone ?? "muted"]}
      {children}
    </div>
  );
}
