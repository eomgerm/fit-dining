import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/cn";

type BadgeProps = Omit<ComponentProps<"span">, "className"> & {
  // 글자 앞 아이콘. Figma는 <CheckIcon size="md" />이고 색은 글자색을 따른다
  icon?: ReactElement;
  className?: string;
};

// Figma 'Badge'. 리뷰의 "재방문 의사 있어요" 같은 알약 모양 표시
export function Badge({ icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center gap-0.75 rounded-full bg-primary-soft px-2 text-label-sm whitespace-nowrap text-primary-strong",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
