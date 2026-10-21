import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "./api-error";

const MAX_RETRIES = 2;

// 일시적인 실패(5xx, 연결 실패, timeout)만 재시도한다.
// 4xx는 다시 보내도 결과가 같고, 429는 재시도가 속도 제한을 더 악화시킨다.
function shouldRetry(failureCount: number, error: Error) {
  if (failureCount >= MAX_RETRIES || !isApiError(error)) return false;
  return error.kind !== "http" || (error.status ?? 0) >= 500;
}

// 요청·사용자 간에 캐시를 공유하지 않도록 컴포넌트에서 한 번만 만든다
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry } },
  });
}
