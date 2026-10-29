"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createQueryClient } from "@/shared/api/query-client";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { clearOnSessionChange } from "./search-thread-auth";

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
