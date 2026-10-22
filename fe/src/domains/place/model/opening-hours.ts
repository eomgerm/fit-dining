import type { DayCode, Hours, OpenStatus } from "./place-types";

export const DAY_LABELS: Record<DayCode, string> = {
  MON: "월",
  TUE: "화",
  WED: "수",
  THU: "목",
  FRI: "금",
  SAT: "토",
  SUN: "일",
};

const seoulFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// 영업시간은 한국 시각이라 기기 시간대와 관계없이 한국 기준 요일과 HH:mm을 쓴다
export function seoulNow(now: Date) {
  const parts = Object.fromEntries(
    seoulFormat.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return {
    day: parts.weekday.toUpperCase() as DayCode,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function todayHours(hours: Hours[], now: Date) {
  const { day } = seoulNow(now);
  return hours.find(({ dayOfWeek }) => dayOfWeek === day);
}

// 장소 상세의 영업 상태 옆 안내. 상태는 BE가 계산한 openStatus를 따르고,
// 영업 종료(CLOSED)일 때만 지금 시각으로 개점 전과 마감 뒤를 가른다. HH:mm은 문자열 비교로 순서가 맞다
export function todayNotice(hours: Hours[], status: OpenStatus, now: Date) {
  const today = todayHours(hours, now);
  if (!today) return;
  if (today.closed) return "오늘 휴무";
  switch (status) {
    case "OPEN":
    case "CLOSING_SOON":
      return today.close && `오늘 ${today.close}까지`;
    case "BREAK":
      return today.breakEnd && `${today.breakEnd}에 다시 열어요`;
    case "CLOSED":
      if (today.open && seoulNow(now).time < today.open) {
        return `${today.open}에 열어요`;
      }
  }
}

// "11:00 - 22:00" 또는 "휴무"
export function hoursText(hours: Hours) {
  if (hours.closed || !hours.open || !hours.close) return "휴무";
  return `${hours.open} - ${hours.close}`;
}
