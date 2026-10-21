import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

// Figma 'Icon'의 공통 틀. 24px 격자, 선 두께 1.75, 색은 부모 글자색(currentColor)을 따른다
const iconVariants = cva("shrink-0 stroke-non-scaling", {
  variants: {
    size: { sm: "size-4", md: "size-5", lg: "size-6" },
  },
  defaultVariants: { size: "lg" },
});

export type IconProps = Omit<ComponentProps<"svg">, "children"> &
  VariantProps<typeof iconVariants> & {
    // 있으면 화면 낭독기가 읽는다. 버튼 이름처럼 옆 글자가 뜻을 전하면 비워 둔다
    label?: string;
  };

export function Icon({
  size,
  label,
  className,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(iconVariants({ size }), className)}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      {...props}
    >
      {children}
    </svg>
  );
}
