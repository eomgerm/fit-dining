import { cva } from "class-variance-authority";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { AvatarStack } from "@/shared/ui/display/avatar";
import { Tag } from "@/shared/ui/display/tag";
import { InfoIcon } from "@/shared/ui/icon/icons/info";

import type { MeetupInfo, MeetupProfile } from "../model/meetup";
import {
  distanceText,
  facilityChips,
  fitLine,
  menuText,
  openStatusLabel,
  PLACE_CATEGORY_LABELS,
  reasonChips,
  type MeetupResultItem,
} from "../model/result";

// 장소 사진, 순위 배지, 핏 점수는 장소 도메인의 부품이라 app이 넘긴다(D-20)
export type ResultCardParts = {
  photo: (src?: string) => ReactNode;
  rank: (rank: number) => ReactNode;
  score: (score: number) => ReactNode;
};

const statusVariants = cva("font-semibold", {
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

// 결과 카드(모임장 6, 참여자 7). 본문은 장소 상세를 연다. 투표에 올리기·여기로 정하기 영역은 투표 단계에서 붙인다(AC-32)
export function ResultCard({
  item,
  info,
  profiles,
  href,
  parts,
}: {
  item: MeetupResultItem;
  info: MeetupInfo;
  profiles: MeetupProfile[];
  href: string;
  parts: ResultCardParts;
}) {
  const fit = fitLine(item.fit, profiles);
  const status = item.openStatus && openStatusLabel(item.openStatus, info);
  const meta = [
    PLACE_CATEGORY_LABELS[item.place.categoryGroup],
    distanceText(item.distance),
  ].filter((part): part is string => !!part);
  const reasons = reasonChips(item.reasons);
  const facilities = facilityChips(item.facilities);

  return (
    <article className="rounded-lg ring-1 ring-line ring-inset">
      <Link
        href={href}
        className="flex flex-col gap-2.5 rounded-lg p-3.5 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <div className="flex gap-3">
          {parts.photo(item.place.thumbnailUrl)}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  {parts.rank(item.rank)}
                  <h3 className="truncate text-title-md text-ink">
                    {item.place.name}
                  </h3>
                </div>
                <p className="text-caption-md text-ink-muted">
                  {meta.join(" · ")}
                  {status && (
                    <>
                      {" · "}
                      <span
                        className={statusVariants({
                          status: item.openStatus,
                        })}
                      >
                        {status}
                      </span>
                    </>
                  )}
                </p>
              </div>
              {item.score !== undefined && parts.score(item.score)}
            </div>
            <p
              className={cn(
                "flex items-center gap-1 text-label-md",
                fit.misfit ? "text-ink-muted" : "text-success",
              )}
            >
              <AvatarStack people={fit.people} />
              <span className="ml-0.5">{fit.text}</span>
            </p>
          </div>
        </div>
        {reasons.length + facilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {reasons.map((reason) => (
              <Tag key={reason} variant="match">
                {reason}
              </Tag>
            ))}
            {facilities.map((facility) => (
              <Tag key={facility}>{facility}</Tag>
            ))}
          </div>
        )}
        {item.menu && (
          <p className="text-caption-md text-ink-muted">
            대표 메뉴 <span className="text-ink">{menuText(item.menu)}</span>
          </p>
        )}
        {item.caution && (
          <p className="flex items-center gap-1 text-caption-md text-ink-muted">
            <InfoIcon size="sm" className="shrink-0" />
            {item.caution}
          </p>
        )}
      </Link>
    </article>
  );
}
