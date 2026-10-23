import { formatClock } from "./search-store";

// 최근 검색. 성공한 새 검색의 문장만 기기에 두고 결과는 두지 않는다(spec 53번)

export type RecentSearch = { sentence: string; at: number };

export const RECENT_SEARCH_LIMIT = 10;

// 맨 위에 넣는다. 같은 문장은 하나만 남기고 최대 개수를 넘으면 오래된 것부터 버린다
export function addRecentSearch(
  list: RecentSearch[],
  sentence: string,
  at: number,
): RecentSearch[] {
  const trimmed = sentence.trim();
  if (!trimmed) return list;
  return [
    { sentence: trimmed, at },
    ...list.filter((item) => item.sentence !== trimmed),
  ].slice(0, RECENT_SEARCH_LIMIT);
}

function isRecentSearch(value: unknown): value is RecentSearch {
  if (typeof value !== "object" || value === null) return false;
  const { sentence, at } = value as Record<string, unknown>;
  return (
    typeof sentence === "string" &&
    sentence.trim() !== "" &&
    typeof at === "number" &&
    Number.isFinite(at)
  );
}

// 저장된 문자열을 읽는다. 없거나 깨졌으면 빈 목록, 형식이 틀린 줄은 버린다
export function parseRecentSearches(raw: string | null): RecentSearch[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isRecentSearch).slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

// 같은 날이면 "오늘 오후 2:10", 다른 날이면 "10월 14일". 요청 기록처럼 기기 시간대 기준이다
export function formatRecentAt(at: number, now: number) {
  const date = new Date(at);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return `오늘 ${formatClock(at)}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
