// 방문일 달력(7-03). 날짜는 "YYYY-MM-DD" KST 날짜 문자열이고 범위는 BE가 준다(D-4).
// 시간대가 끼어들지 않게 UTC 자정으로만 계산한다

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export type YearMonth = { year: number; month: number };

function parse(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function format(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function monthOf(date: string): YearMonth {
  const value = parse(date);
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

// min이 든 달부터 max가 든 달까지. min이 max보다 뒤거나 날짜가 깨졌으면 비어 있다
export function monthsBetween(min: string, max: string): YearMonth[] {
  const end = monthOf(max);
  const months: YearMonth[] = [];
  let { year, month } = monthOf(min);
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month = (month % 12) + 1;
    if (month === 1) year++;
  }
  return months;
}

// 일요일부터 시작하는 주 단위 칸. 그 달이 아닌 칸은 null
export function calendarWeeks({ year, month }: YearMonth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let day = 1; day <= days; day++) {
    cells.push(format(new Date(Date.UTC(year, month - 1, day))));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export type DayState = "available" | "reviewed" | "outside";

export function dayState(
  date: string,
  range: { min: string; max: string },
  reviewedDates: readonly string[],
): DayState {
  if (date < range.min || date > range.max) return "outside";
  return reviewedDates.includes(date) ? "reviewed" : "available";
}

export function dayOfMonth(date: string) {
  return parse(date).getUTCDate();
}

// "10월 17일 (토)"
export function formatDay(date: string) {
  const value = parse(date);
  return `${value.getUTCMonth() + 1}월 ${value.getUTCDate()}일 (${WEEKDAYS[value.getUTCDay()]})`;
}

// 7-01 방문일 줄. 오늘이면 앞에 "오늘 · "를 붙인다
export function formatVisitDate(date: string, today: string) {
  return date === today ? `오늘 · ${formatDay(date)}` : formatDay(date);
}

export function formatMonth({ year, month }: YearMonth) {
  return `${year}년 ${month}월`;
}
