import type { Break, DayCode, Hours, OpenStatus } from "./place-types";

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

const DAYS = Object.keys(DAY_LABELS) as DayCode[];

function dayAfter(day: DayCode, offset: number) {
  return DAYS[(DAYS.indexOf(day) + offset + DAYS.length) % DAYS.length];
}

function hoursOf(hours: Hours[], day: DayCode) {
  return hours.find(({ dayOfWeek }) => dayOfWeek === day);
}

// 마감 "00:00"은 화면에서 "24:00"이다
function closeText(close: string) {
  return close === "00:00" ? "24:00" : close;
}

// 24시간 영업(00:00 – 00:00)
function isAllDay({ open, close }: Hours) {
  return open === "00:00" && close === "00:00";
}

// 영업 구간이 다음 날 새벽으로 넘어가는지. 마감 00:00은 자정에 끝나므로 넘어가지 않는다
function crossesMidnight({ open, close }: Hours) {
  return !!open && !!close && close !== "00:00" && close <= open;
}

// start <= time < end. 자정을 넘는 브레이크(23:30 – 00:30)도 다룬다. HH:mm은 문자열 비교로 순서가 맞다
function within(time: string, { start, end }: Break) {
  return start <= end
    ? time >= start && time < end
    : time >= start || time < end;
}

// 장소 상세의 영업 상태 옆 안내. 상태는 BE가 계산한 openStatus를 따르고, 문구만 영업시간으로 고른다.
// 지금이 어제 영업의 새벽 부분이면 오늘 줄 대신 어제 줄로 안내한다
export function todayNotice(hours: Hours[], status: OpenStatus, now: Date) {
  if (status === "UNKNOWN") return;
  const { day, time } = seoulNow(now);
  const yesterday = hoursOf(hours, dayAfter(day, -1));
  if (yesterday && crossesMidnight(yesterday) && time < yesterday.close!) {
    if (status === "BREAK") return breakNotice(yesterday, time);
    if (status === "OPEN" || status === "CLOSING_SOON") {
      return `${yesterday.close}까지`;
    }
    return;
  }

  const today = hoursOf(hours, day);
  if (!today) return;
  if (today.closed) return "오늘 휴무";
  switch (status) {
    case "OPEN":
    case "CLOSING_SOON":
      if (!today.open || !today.close) return;
      if (isAllDay(today)) {
        const tomorrow = hoursOf(hours, dayAfter(day, 1));
        return tomorrow?.open === "00:00" ? "24시간 영업" : "오늘 24:00까지";
      }
      if (crossesMidnight(today)) return `내일 ${today.close}까지`;
      return `오늘 ${closeText(today.close)}까지`;
    case "BREAK":
      return breakNotice(today, time);
    case "CLOSED":
      if (today.open && time < today.open) {
        return `${today.open}에 열어요`;
      }
  }
}

function breakNotice(hours: Hours, time: string) {
  const current = hours.breaks.find((pause) => within(time, pause));
  return current && `${current.end}에 다시 열어요`;
}

// "11:00 – 22:00", "17:00 – 02:00", "24시간 영업", "휴무", "정보 없음"(와이어프레임의 시각 범위 표기)
export function hoursText(hours: Hours) {
  if (hours.closed) return "휴무";
  if (!hours.open || !hours.close) return "정보 없음";
  if (isAllDay(hours)) return "24시간 영업";
  return `${hours.open} – ${closeText(hours.close)}`;
}

// 요일별 표의 덧붙는 줄. 브레이크마다 "15:00 – 16:00 브레이크타임", 그리고 "14:30, 21:30 라스트오더". 휴무일이면 없다
export function hoursNotes(hours: Hours) {
  if (hours.closed) return [];
  const notes = hours.breaks.map(
    ({ start, end }) => `${start} – ${end} 브레이크타임`,
  );
  if (hours.lastOrders.length > 0) {
    notes.push(`${hours.lastOrders.join(", ")} 라스트오더`);
  }
  return notes;
}
