import type { PlaceSearchRequest, PlaceSearchResponse } from "./place-types";
import { formatClock, type EntryKind } from "./search-store";

// 검색 thread. LLM 대화처럼 새 검색 하나가 thread 하나를 시작하고, 그 뒤의 후속 조건,
// "이 지역에서 검색", "이 조건으로 다시 검색"이 같은 thread에 요청으로 쌓인다(spec 53번).
// 요청마다 그때 받은 첫 페이지를 스냅샷으로 둔다

export type ThreadTurn = {
  id: string;
  kind: EntryKind;
  // 후속 조건과 "이 지역에서 검색"의 기준 요청
  baseId?: string;
  at: number;
  // 첫 페이지 요청 본문. "이 조건으로 다시 검색"이 그대로 다시 보낸다
  request: PlaceSearchRequest;
  // 첫 페이지 응답. 다시 열 때 다음 페이지를 부르지 않도록 커서는 두지 않는다
  response: PlaceSearchResponse;
};

export type SearchThread = { id: string; turns: ThreadTurn[] };

export function appendTurn(
  thread: SearchThread | undefined,
  threadId: string,
  turn: ThreadTurn,
): SearchThread {
  const response = { ...turn.response };
  delete response.nextCursor;
  return {
    id: threadId,
    turns: [...(thread?.turns ?? []), { ...turn, response }],
  };
}

// 최근 검색 줄의 이름은 thread를 시작한 문장이다
export function threadTitle(thread: SearchThread) {
  return thread.turns[0].request.query;
}

export function threadUpdatedAt(thread: SearchThread) {
  return thread.turns[thread.turns.length - 1].at;
}

// 마지막 요청 시각 최신순
export function sortThreads(threads: SearchThread[]) {
  return [...threads].sort((a, b) => threadUpdatedAt(b) - threadUpdatedAt(a));
}

// 최근 검색 줄 하나. 회원 목록은 서버가 이 모양으로 주고, 비회원은 기기 thread에서 만든다
export type ThreadSummary = { id: string; title: string; lastAt: number };

export function summarizeThread(thread: SearchThread): ThreadSummary {
  return {
    id: thread.id,
    title: threadTitle(thread),
    lastAt: threadUpdatedAt(thread),
  };
}

// 페이지를 차례로 잇는다. 페이지 사이에 순서가 바뀌어 같은 id가 다시 오면 먼저 받은 것만 남긴다
export function mergeSummaries(pages: ThreadSummary[][]) {
  const seen = new Set<string>();
  return pages.flat().filter(({ id }) => !seen.has(id) && seen.add(id));
}

const KINDS: readonly EntryKind[] = ["new", "followUp", "region"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTurn(value: unknown): value is ThreadTurn {
  if (!isObject(value)) return false;
  const { id, kind, baseId, at, request, response } = value;
  return (
    typeof id === "string" &&
    KINDS.includes(kind as EntryKind) &&
    (baseId === undefined || typeof baseId === "string") &&
    typeof at === "number" &&
    Number.isFinite(at) &&
    isObject(request) &&
    typeof request.query === "string" &&
    request.query.trim() !== "" &&
    isObject(response) &&
    Array.isArray(response.items) &&
    typeof response.totalCount === "number" &&
    isObject(response.conditions)
  );
}

function isThread(value: unknown): value is SearchThread {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.turns) &&
    value.turns.length > 0 &&
    value.turns.every(isTurn)
  );
}

// 저장된 문자열을 읽는다. 없거나 깨졌으면 빈 목록, 형식이 틀린 thread는 버린다
export function parseThreads(raw: string | null): SearchThread[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isThread) : [];
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
