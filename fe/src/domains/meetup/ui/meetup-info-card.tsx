import type { ReactNode } from "react";

import { ClockIcon } from "@/shared/ui/icon/icons/clock";

import { areaLabel, CATEGORY_LABELS, type MeetupInfo } from "../model/meetup";
import { formatExpiresOn, formatWhen } from "../model/meetup-date";

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-xs bg-surface px-2 text-caption-sm text-ink-muted">
      {children}
    </span>
  );
}

// 모임 정보(대기 화면, 프로필 고르기의 정보 칸). 지역, 업종, 날짜·시간, 인원, 설명을 보이고, 대기 화면에서는 열 수 있는
// 마지막 날도 보인다(AC-29). action은 오른쪽 위에 세로 가운데로 두는 버튼 자리다
export function MeetupInfoCard({
  info,
  showHost = false,
  showExpiry = true,
  action,
}: {
  info: MeetupInfo;
  // 프로필 고르기처럼 처음 보는 사람에게 "민지님의 모임"을 보인다
  showHost?: boolean;
  showExpiry?: boolean;
  action?: ReactNode;
}) {
  return (
    <section
      aria-label="모임 정보"
      className="flex items-center gap-3 rounded-lg bg-surface-warm p-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {showHost && info.hostNickname && (
          <p className="text-caption-md text-ink-muted">
            {info.hostNickname}님의 모임
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          <Tag>{areaLabel(info.area)}</Tag>
          <Tag>{CATEGORY_LABELS[info.category]}</Tag>
          <Tag>
            {info.date ? formatWhen(info.date, info.time) : "날짜 미정"}
          </Tag>
          {info.headcount !== undefined && <Tag>{`${info.headcount}명`}</Tag>}
        </div>
        {info.description && (
          <p className="text-title-sm text-ink">{info.description}</p>
        )}
        {showExpiry && (
          <p className="flex items-center gap-1 text-caption-md text-ink-muted">
            <ClockIcon size="sm" className="shrink-0" />
            {formatExpiresOn(info.expiresOn)}
          </p>
        )}
      </div>
      {action}
    </section>
  );
}

// 화면 위쪽 제목 "선릉역 모임"
export function meetupTitle(info: MeetupInfo) {
  const area = areaLabel(info.area);
  return area ? `${area} 모임` : "모임";
}
