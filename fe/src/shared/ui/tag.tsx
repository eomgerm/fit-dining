import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

// Figma 'Tag'. 장소·리뷰의 특징을 보여 주는 표시용 태그(누를 수 없다)
const tagVariants = cva(
  "inline-flex h-6 items-center gap-0.5 rounded-xs px-2 whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-surface-sunken text-caption-sm text-ink-muted",
        // 내 취향과 맞는 특징
        match: "bg-primary-soft text-label-sm text-primary-strong",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type TagProps = Omit<ComponentProps<"span">, "className" | "prefix"> &
  VariantProps<typeof tagVariants> & {
    // 본문 앞에 굵게 붙는 말. Figma Tag=Bad는 <Tag prefix="아쉬움">이다
    prefix?: ReactNode;
    className?: string;
  };

export function Tag({
  variant,
  prefix,
  className,
  children,
  ...props
}: TagProps) {
  return (
    <span className={cn(tagVariants({ variant }), className)} {...props}>
      {prefix && <span className="text-label-sm">{prefix}</span>}
      {children}
    </span>
  );
}
