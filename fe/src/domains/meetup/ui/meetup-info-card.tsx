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

// 모임 정보(참여자 6 대기 화면의 정보 칸). 지역, 업종, 날짜·시간, 인원, 설명과 열 수 있는 마지막 날을 보인다(AC-29)
export function MeetupInfoCard({ info }: { info: MeetupInfo }) {
  return (
    <section
      aria-label="모임 정보"
      className="flex flex-col gap-2.5 rounded-lg bg-surface-warm p-4"
    >
      <div className="flex flex-wrap gap-1">
        <Tag>{areaLabel(info.area)}</Tag>
        <Tag>{CATEGORY_LABELS[info.category]}</Tag>
        <Tag>{info.date ? formatWhen(info.date, info.time) : "날짜 미정"}</Tag>
        {info.headcount !== undefined && <Tag>{`${info.headcount}명`}</Tag>}
      </div>
      {info.description && (
        <p className="text-title-sm text-ink">{info.description}</p>
      )}
      <p className="flex items-center gap-1 text-caption-md text-ink-muted">
        <ClockIcon size="sm" className="shrink-0" />
        {formatExpiresOn(info.expiresOn)}
      </p>
    </section>
  );
}

// 화면 위쪽 제목 "선릉역 모임"
export function meetupTitle(info: MeetupInfo) {
  const area = areaLabel(info.area);
  return area ? `${area} 모임` : "모임";
}
