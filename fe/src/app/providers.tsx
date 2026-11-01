"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { setSearchAccess } from "@/domains/place/api/place-queries";
import { createQueryClient } from "@/shared/api/query-client";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { searchAccess } from "./search-access";
import { clearOnSessionChange } from "./search-thread-auth";

// 검색 요청에 토큰이나 비회원 답을 싣는다(place-ai-search D-16). 첫 화면의 쿼리가 effect보다 먼저 나가므로 모듈에서 정한다
setSearchAccess(searchAccess);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  // 로그인 세션이 바뀌면 어느 페이지에서든 이전 세션의 캐시와 검색 화면 상태를 비운다(search-thread D-6)
  useEffect(() => clearOnSessionChange(queryClient), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
