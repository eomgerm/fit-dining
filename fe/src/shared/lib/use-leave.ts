"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

// Navigation API에서 쓰는 부분. TypeScript DOM 타입에 아직 없다
type SessionHistory = {
  currentEntry: { index: number } | null;
  entries(): { url: string | null }[];
};

// 상위 화면으로 나간다. 바로 앞 기록이 그 화면이면 돌아가고, 아니면 지금 기록을 그 화면으로 바꾼다(meetup D-37)
export function useLeave(parent: string) {
  const router = useRouter();
  return useCallback(() => {
    if (previousPath() === parent) router.back();
    else router.replace(parent);
  }, [router, parent]);
}

// Navigation API가 없거나, 브라우저가 앞 기록(다른 문서)의 주소를 숨기면 undefined다
function previousPath() {
  const history = (window as { navigation?: SessionHistory }).navigation;
  const index = history?.currentEntry?.index ?? 0;
  const url = index > 0 ? history?.entries()[index - 1]?.url : undefined;
  return url ? new URL(url).pathname : undefined;
}
