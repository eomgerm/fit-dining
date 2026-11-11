import { cva } from "class-variance-authority";

import { cn } from "@/shared/lib/cn";
import { CrownIcon } from "@/shared/ui/icon/icons/crown";
import { UserIcon } from "@/shared/ui/icon/icons/user";

// 색 번호(0~7)마다 바탕과 글자. Tailwind가 클래스를 찾을 수 있게 이름을 그대로 적는다
const PALETTE = [
  "bg-avatar-0 text-avatar-0-ink",
  "bg-avatar-1 text-avatar-1-ink",
  "bg-avatar-2 text-avatar-2-ink",
  "bg-avatar-3 text-avatar-3-ink",
  "bg-avatar-4 text-avatar-4-ink",
  "bg-avatar-5 text-avatar-5-ink",
  "bg-avatar-6 text-avatar-6-ink",
  "bg-avatar-7 text-avatar-7-ink",
] as const;

const avatarVariants = cva(
  "flex shrink-0 items-center justify-center rounded-full font-bold select-none",
  {
    variants: {
      size: {
        // 목록(대기 화면, 친구들 취향)
        md: "size-9 text-label-md",
        // 확인 창
        lg: "size-12 text-title-lg",
        // 프로필 고르기 격자
        xl: "size-16 text-title-lg",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const badgeVariants = cva(
  "flex items-center justify-center rounded-full ring-2 ring-surface",
  {
    variants: {
      size: { md: "size-3.5", lg: "size-4.5", xl: "size-5.5" },
      kind: {
        host: "bg-host-badge text-on-primary",
        member: "border border-icon-subtle bg-surface text-ink-muted",
      },
      // 아바타 오른쪽 아래에 붙이거나, 설명 글 안에 글자처럼 둔다
      placement: {
        corner: "absolute -right-0.5 -bottom-0.5",
        inline: "inline-flex align-middle",
      },
    },
    defaultVariants: { placement: "corner" },
  },
);

// 배지(14·18·22px) 안의 아이콘 크기
const BADGE_ICON = { md: "size-2.5", lg: "size-3", xl: "size-3.5" } as const;

export type AvatarBadge = "host" | "member";

type AvatarProps = {
  name: string;
  // 색 번호(0~7)
  color: number;
  size?: "md" | "lg" | "xl";
  // 모임장은 왕관, 다른 회원은 사람 배지. 모임장은 늘 회원이라 둘을 겹치지 않는다(D-20)
  badge?: AvatarBadge;
  className?: string;
};

// 이름의 첫 글자를 색 원에 담은 아바타. 이름은 옆 글자가 읽으므로 원은 화면 낭독기에서 숨기고 배지만 읽게 한다
export function Avatar({
  name,
  color,
  size = "md",
  badge,
  className,
}: AvatarProps) {
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn(
          avatarVariants({ size }),
          PALETTE[color % PALETTE.length],
        )}
      >
        {initial}
      </span>
      {badge && <AvatarBadgeMark kind={badge} size={size} />}
    </span>
  );
}

// 모임장·회원 배지. 아바타에 붙거나, 프로필 고르기의 "모임장 · 회원" 설명처럼 글 안에 둔다
export function AvatarBadgeMark({
  kind,
  size = "md",
  placement,
}: {
  kind: AvatarBadge;
  size?: "md" | "lg" | "xl";
  placement?: "corner" | "inline";
}) {
  return (
    <span
      role="img"
      aria-label={kind === "host" ? "모임장" : "회원"}
      className={badgeVariants({ size, kind, placement })}
    >
      {kind === "host" ? (
        <CrownIcon className={BADGE_ICON[size]} strokeWidth={2.25} />
      ) : (
        <UserIcon className={BADGE_ICON[size]} strokeWidth={2.25} />
      )}
    </span>
  );
}
