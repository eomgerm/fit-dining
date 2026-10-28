import { useSyncExternalStore } from "react";

import type { VisitEntry } from "../model/visit-entry";

// 확인 결과는 메모리로만 넘긴다. 주소에 실으면 서버 요청과 로그에 남을 수 있다(AC-22, D-43).
// 숨겨 둔 작성 화면이 다시 보여도 새 결과를 알도록 구독하고, seq로 새로 들어온 것인지 가린다
type StoredEntry = VisitEntry & { placeId: number; seq: number };

let current: StoredEntry | undefined;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function saveVisitEntry(placeId: number, entry: VisitEntry) {
  seq += 1;
  current = { ...entry, placeId, seq };
  notify();
}

// 작성 흐름이 결과를 옮겨 간 뒤와 "X"·등록으로 나갈 때 지운다. 뒤로 가기로 나갔다가 주소로 다시 열어도 예전 결과가 남지 않는다
export function clearVisitEntry(placeId: number) {
  if (current?.placeId !== placeId) return;
  current = undefined;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVisitEntry(placeId: number) {
  const entry = useSyncExternalStore(
    subscribe,
    () => current,
    () => undefined,
  );
  return entry?.placeId === placeId ? entry : undefined;
}
