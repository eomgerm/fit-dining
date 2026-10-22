import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";

const titleVariants = cva("flex items-center gap-1 text-ink", {
  variants: {
    size: {
      // 장소 상세 섹션, 방문 평가 질문
      lg: "text-title-lg",
      // 리뷰 쓰기 입력 블록
      md: "text-title-md",
    },
  },
  defaultVariants: { size: "lg" },
});

type SectionHeaderProps = Omit<ComponentProps<"div">, "className" | "title"> &
  VariantProps<typeof titleVariants> & {
    title: ReactNode;
    // 제목 옆 회색 숫자(리뷰 12)
    count?: number;
    // 있으면 제목·개수·⟩ 전체가 링크가 된다("메뉴 12 ⟩")
    href?: string;
    // 제목 옆 작은 안내("최대 5장")
    hint?: ReactNode;
    // 제목 아래 설명
    description?: ReactNode;
    // 오른쪽 끝(예: <SectionHeaderAction>최신순</SectionHeaderAction>)
    action?: ReactNode;
    className?: string;
  };

// Figma 'sec-h'·'rv-head'·'rf-block-h'. 화면 제목(TopBar h1) 아래 섹션이라 h2로 그린다
export function SectionHeader({
  size,
  title,
  count,
  href,
  hint,
  description,
  action,
  className,
  ...props
}: SectionHeaderProps) {
  const label = (
    <>
      {title}
      {count !== undefined && <span className="text-ink-muted">{count}</span>}
    </>
  );

  return (
    <div
      className={cn("flex items-start justify-between gap-3", className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className={titleVariants({ size })}>
            {href ? (
              <Link href={href} className="flex h-11 items-center gap-1">
                {label}
                <ChevronRightIcon className="size-4.5 text-ink-muted" />
              </Link>
            ) : (
              label
            )}
          </h2>
          {hint && (
            <span className="text-caption-sm text-ink-subtle">{hint}</span>
          )}
        </div>
        {description && (
          <p className="text-body-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// 오른쪽 "최신순" 글자 버튼. 터치 높이 44를 지키면서 머리 줄 높이(28)는 늘리지 않는다
export function SectionHeaderAction(
  props: Omit<BaseButton.Props, "className">,
) {
  return (
    <BaseButton
      className="-my-2 flex h-11 shrink-0 items-center px-1 text-caption-md text-ink-muted select-none data-disabled:pointer-events-none"
      {...props}
    />
  );
}
