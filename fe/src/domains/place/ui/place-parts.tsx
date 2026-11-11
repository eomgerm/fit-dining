import { cva } from "class-variance-authority";
import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

import { distanceMeters, formatDistance } from "../model/nearby";
import { CATEGORY_LABELS, OPEN_STATUS_LABELS } from "../model/place-labels";
import type { LatLng, OpenStatus, PlaceSummary } from "../model/place-types";

// 영업 상태 글자색. 저장한 장소 카드도 쓴다
export const statusVariants = cva("", {
  variants: {
    status: {
      OPEN: "text-success",
      CLOSING_SOON: "text-warning",
      BREAK: "text-warning",
      CLOSED: "text-ink-muted",
      UNKNOWN: "",
    },
  },
});

// "카페 · 350m · 영업 중". 거리는 위치를 얻었을 때만, 영업 상태는 알 때만 붙는다
export function PlaceMeta({
  place,
  here,
  status,
  extra,
  className,
}: {
  place: PlaceSummary;
  here?: LatLng;
  status?: OpenStatus;
  // 맨 뒤에 붙는 말(자동완성의 "메뉴: …")
  extra?: ReactNode;
  className?: string;
}) {
  const statusLabel = status && OPEN_STATUS_LABELS[status];
  const parts: ReactNode[] = [CATEGORY_LABELS[place.categoryGroup]];
  if (here) {
    parts.push(formatDistance(distanceMeters(here, place)));
  }
  if (statusLabel) {
    parts.push(
      <span
        key="status"
        className={cn("font-semibold", statusVariants({ status }))}
      >
        {statusLabel}
      </span>,
    );
  }
  if (extra) parts.push(extra);

  return (
    <p className={cn("text-caption-md text-ink-muted", className)}>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {part}
        </span>
      ))}
    </p>
  );
}

// 상세의 "영업 중 · 오늘 22:00까지". UNKNOWN이면 그리지 않는다
export function OpenStatusText({
  status,
  notice,
  className,
}: {
  status: OpenStatus;
  notice?: string;
  // 글자 크기·색을 바꿀 때만 넘긴다(홈 탭 영업시간 줄, 정보 탭 영업시간)
  className?: string;
}) {
  const label = OPEN_STATUS_LABELS[status];
  if (!label) return null;
  return (
    <p className={cn("text-body-sm text-ink-muted", className)}>
      <span className={cn("font-semibold", statusVariants({ status }))}>
        {label}
      </span>
      {notice && ` · ${notice}`}
    </p>
  );
}

// 사진이 없을 때의 자리표시 그라데이션
export function PhotoPlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-linear-to-br from-primary-line to-primary-disabled",
        className,
      )}
    />
  );
}

export function PlacePhoto({
  src,
  className,
}: {
  src?: string;
  className?: string;
}) {
  if (!src) return <PhotoPlaceholder className={className} />;
  // 사진 주소의 도메인이 아직 정해지지 않아 원격 이미지 설정 없이 원본을 그대로 쓴다
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <Image src={src} alt="" fill unoptimized className="object-cover" />
    </div>
  );
}

const rankVariants = cva(
  "inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-label-sm",
  {
    variants: {
      selected: {
        true: "bg-primary text-on-primary",
        false: "bg-secondary text-on-secondary",
      },
    },
    defaultVariants: { selected: false },
  },
);

// 카드와 지도 핀에 같은 번호를 보인다
export function RankBadge({
  rank,
  selected,
}: {
  rank: number;
  selected?: boolean;
}) {
  return (
    <span className={rankVariants({ selected })} aria-label={`${rank}위`}>
      {rank}
    </span>
  );
}
