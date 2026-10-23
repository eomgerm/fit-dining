import { useSyncExternalStore } from "react";

import {
  parseThreads,
  sortThreads,
  type SearchThread,
} from "../model/search-threads";

// 검색 thread 저장소. 화면은 이 모듈로만 thread를 읽고 쓴다.
// 지금은 기기(localStorage)에 두고, 서버 저장(목록은 cursor paging)이 생기면 이 모듈만 바꾼다(spec 53번).
// 개수 제한과 지우기 규칙은 없다. 읽거나 쓰지 못하면 저장하지 않을 뿐 검색은 그대로 동작한다
const STORAGE_KEY = "fit-dining:search-threads";

const EMPTY: SearchThread[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: SearchThread[] = EMPTY;

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// 저장된 문자열이 그대로면 같은 배열을 돌려줘 화면이 다시 그려지지 않게 한다
function getSnapshot() {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = sortThreads(parseThreads(raw));
  }
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 다른 탭에서 바뀐 것도 반영한다
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// 마지막 요청 시각 최신순 thread 목록
export function listThreads() {
  return getSnapshot();
}

export function getThread(id: string) {
  return getSnapshot().find((thread) => thread.id === id);
}

// 같은 id의 thread는 바꾸고, 없으면 더한다
export function saveThread(thread: SearchThread) {
  const others = getSnapshot().filter(({ id }) => id !== thread.id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([thread, ...others]));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

export function useThreads() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
