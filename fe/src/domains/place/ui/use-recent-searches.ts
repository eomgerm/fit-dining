import { useSyncExternalStore } from "react";

import {
  addRecentSearch,
  parseRecentSearches,
  type RecentSearch,
} from "../model/recent-searches";

// 최근 검색을 기기(localStorage)에 둔다. 읽거나 쓰지 못하면(사생활 보호 모드 등) 빈 목록이고 검색은 그대로 동작한다
const STORAGE_KEY = "fit-dining:recent-searches";

const EMPTY: RecentSearch[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: RecentSearch[] = EMPTY;

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
    cached = parseRecentSearches(raw);
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

export function useRecentSearches() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

// 성공한 새 검색의 문장을 맨 위에 둔다
export function recordRecentSearch(sentence: string, at = Date.now()) {
  const next = addRecentSearch(getSnapshot(), sentence, at);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}
