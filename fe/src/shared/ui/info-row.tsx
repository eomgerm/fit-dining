import type { ComponentProps, ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { ChevronRightIcon } from "@/shared/ui/icons/chevron-right";

type InfoRowProps = Omit<ComponentProps<"a">, "className" | "title"> & {
  // 20px 아이콘(size="md"). 색은 ink-muted로 맞춘다
  icon: ReactElement;
  title: ReactNode;
  // Figma Type=Two-line의 아래 설명
  description?: ReactNode;
  // 있으면 줄 전체가 링크가 되고 오른쪽 끝에 ⟩를 붙인다(Figma Type=Link).
  // 나머지 props(target 등)는 링크일 때만 <a>에 붙는다
  href?: string;
  className?: string;
};

// Figma 'Info row'. 장소 정보의 위치·연락처 줄
export function InfoRow({
  icon,
  title,
  description,
  href,
  className,
  ...props
}: InfoRowProps) {
  const rowClassName = cn("flex items-start gap-3 py-2.5", className);
  const content = (
    <>
      <span className="mt-0.5 text-ink-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body-md text-ink">{title}</span>
        {description && (
          <span className="text-caption-md text-ink-muted">{description}</span>
        )}
      </span>
    </>
  );

  if (!href) return <div className={rowClassName}>{content}</div>;

  return (
    <a href={href} className={rowClassName} {...props}>
      {content}
      <ChevronRightIcon size="md" className="mt-0.5 text-ink-muted" />
    </a>
  );
}
