// 모임 날짜·시간의 표기와 고를 수 있는 범위. 날짜는 모두 KST로 판정한다(BE MeetupSchedule과 같은 규칙)

export const DATE_RANGE_DAYS = 30;

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const kstDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const kstTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

// "2026-11-11"
export function kstToday(now: Date) {
  return kstDate.format(now);
}

export function addDays(date: string, days: number) {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

// 날짜 고르기의 처음과 끝("2026-11-11", "2026-12-11")
export function selectableRange(now: Date) {
  const today = kstToday(now);
  return { min: today, max: addDays(today, DATE_RANGE_DAYS) };
}

// 날짜가 오늘부터 30일 뒤까지이고, 오늘이면 시각이 지나지 않았을 때 참이다. 시각만 있으면 고를 수 없다
export function isSelectable(
  date: string | undefined,
  time: string | undefined,
  now: Date,
) {
  if (!date) return !time;
  const { min, max } = selectableRange(now);
  if (date < min || date > max) return false;
  // BE처럼 초까지 비교한다. 19:00은 19:00:30에 이미 지난 시각이다
  return !time || date !== min || `${time}:00` >= kstTime.format(now);
}

// "11월 14일 (금)"
export function formatDate(date: string) {
  const { year, month, day } = parts(date);
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}월 ${day}일 (${weekday})`;
}

function period(hour: number) {
  if (hour < 6) return "새벽";
  if (hour < 12) return "오전";
  if (hour < 18) return "오후";
  if (hour < 22) return "저녁";
  return "밤";
}

function clock(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return { hour, minute, h12: hour % 12 || 12 };
}

// 시간 고르기 칸의 표기 "저녁 7:00"
export function formatTime(time: string) {
  const { hour, minute, h12 } = clock(time);
  return `${period(hour)} ${h12}:${String(minute).padStart(2, "0")}`;
}

// 모임 정보의 표기 "11월 14일 (금) 저녁 7시", 시각이 없으면 "11월 14일 (금)"
export function formatWhen(date: string, time?: string) {
  if (!time) return formatDate(date);
  const { hour, minute, h12 } = clock(time);
  const minutes = minute ? ` ${minute}분` : "";
  return `${formatDate(date)} ${period(hour)} ${h12}시${minutes}`;
}

// "11월 21일까지 열 수 있어요"
export function formatExpiresOn(expiresOn: string) {
  const { month, day } = parts(expiresOn);
  return `${month}월 ${day}일까지 열 수 있어요`;
}

// 고른 날짜로 열 수 있는 마지막 날. 날짜가 없으면 오늘 기준이다(D-23)
export function lastOpenDay(date: string | undefined, now: Date) {
  return addDays(date ?? kstToday(now), 7);
}
