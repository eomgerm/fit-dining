import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

// 아이콘 원의 바탕과 아이콘 색. 아이콘은 currentColor라 원의 글자색을 따른다
const iconCircleVariants = cva(
  "flex size-13 items-center justify-center rounded-full",
  {
    variants: {
      tone: {
        default: "bg-surface-sunken text-ink-muted",
        warn: "bg-warning-soft text-warning",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

type EmptyStateProps = Omit<ComponentProps<"div">, "className" | "title"> &
  VariantProps<typeof iconCircleVariants> & {
    // 24px 아이콘(기본 크기). 화면마다 다르다(wifi-off, chat, bookmark-filled 등)
    icon: ReactElement;
    title: ReactNode;
    // 여러 문단을 넣어도 된다
    description?: ReactNode;
    // 보통 <Button variant="outline" size="md">
    action?: ReactNode;
    className?: string;
  };

// Figma 'Empty state'. 불러오기 실패·결과 없음처럼 내용 대신 보여 주는 안내
export function EmptyState({
  tone,
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-4 pt-7 pb-2 text-center",
        className,
      )}
      {...props}
    >
      <span className={iconCircleVariants({ tone })}>{icon}</span>
      <h2 className="mt-4 text-title-lg text-ink">{title}</h2>
      {description && (
        <div className="mt-1.5 text-body-sm text-ink-muted">{description}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
