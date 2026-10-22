import { useSyncExternalStore } from "react";

import { searchStore } from "../model/search-store";

// 검색 화면 상태를 화면에 잇는다. 상세로 갔다 와도 모듈에 남아 있어 그대로 보인다
export function useSearchStore() {
  return useSyncExternalStore(
    searchStore.subscribe,
    searchStore.getSnapshot,
    searchStore.getSnapshot,
  );
}

// 위치를 얻었을 때만 좌표. 거리는 이 값이 있을 때만 보인다
export function useHere() {
  const { location } = useSearchStore();
  return location.status === "ok" ? location.here : undefined;
}
