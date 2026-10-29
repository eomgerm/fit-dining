import type { QueryClient } from "@tanstack/react-query";

import {
  clearSession,
  getSession,
  restore,
  subscribe,
  type AuthSession,
} from "@/domains/auth/api/auth-client";
import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { searchStore } from "@/domains/place/model/search-store";
import {
  resetThreadSession,
  type MemberKey,
  type SessionKey,
  type ThreadAuth,
} from "@/domains/place/ui/thread-storage";
import { isApiError } from "@/shared/api/api-error";

// 검색 기록의 세션 키와 인증 연결(search-thread D-5, D-6). place는 auth를 import하지 않으므로 app이 잇는다

const RESTORE_TIMEOUT_MS = 3_000;
const GUEST: SessionKey = { kind: "guest" };
const UNKNOWN: SessionKey = { kind: "unknown" };

// 서버가 세션이 없다고 확인해 줬다. getSession()이 세션을 돌려줄 때까지 다시 복원하지 않는다
let signedOut = false;
// 마지막으로 확인된 세션 키. 확인된 값이 다른 확인된 값으로 바뀌면 세션이 바뀐 것이다
let confirmed: SessionKey | undefined;
let watching = false;
const changeListeners = new Set<() => void>();

const keyOf = (session: AuthSession): MemberKey => ({
  kind: "member",
  userId: session.userId,
  sessionId: session.sessionId,
});

function sameKey(a: SessionKey, b: SessionKey) {
  if (a.kind !== "member" || b.kind !== "member") return a.kind === b.kind;
  return a.userId === b.userId && a.sessionId === b.sessionId;
}

function currentKey(): SessionKey {
  const session = getSession();
  if (session) return keyOf(session);
  return signedOut ? GUEST : UNKNOWN;
}

// 모름이 확인된 값이 되는 것과 같은 세션의 AT 갱신은 바뀐 것이 아니다
function observe() {
  const key = currentKey();
  if (key.kind === "unknown") return;
  const previous = confirmed;
  confirmed = key;
  if (previous && !sameKey(previous, key)) {
    changeListeners.forEach((listener) => listener());
  }
}

function watch() {
  if (watching) return;
  watching = true;
  subscribe(() => {
    // 세션 없이 알림이 오면 로그아웃, 다른 탭의 로그아웃, 갱신 실패, 인증 상실 중 하나라 세션 없음이 확인된 것이다
    signedOut = getSession() === null;
    observe();
  });
}

function restoreWithin(ms: number) {
  return new Promise<AuthSession>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    restore()
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function resolveKey(): Promise<SessionKey> {
  watch();
  const current = currentKey();
  if (current.kind !== "unknown") {
    observe();
    return current;
  }
  try {
    const session = await restoreWithin(RESTORE_TIMEOUT_MS);
    observe();
    return keyOf(session);
  } catch (error) {
    // 서버가 401로 세션 없음을 확인해 줬을 때만 비회원이다. 시간 초과나 연결 오류는 다음 저장 때 다시 확인한다
    if (!isApiError(error) || error.status !== 401) return UNKNOWN;
    signedOut = true;
    observe();
    return currentKey();
  }
}

// key 세션일 때만 보낸다. withAccessToken은 계정을 확인하지 않으므로 처음 토큰과 갱신한 토큰 모두 여기서 비교한다
class SessionMismatchError extends Error {}

async function sendAs<T>(
  key: MemberKey,
  request: (accessToken: string) => Promise<T>,
) {
  try {
    return await withAccessToken((accessToken) => {
      const session = getSession();
      if (
        session?.accessToken !== accessToken ||
        !sameKey(keyOf(session), key)
      ) {
        throw new SessionMismatchError("다른 로그인 세션입니다");
      }
      return request(accessToken);
    });
  } catch (error) {
    // 만료가 아닌 401이나 갱신하고도 401이면 인증을 잃었다. 서버 로그아웃이나 다른 탭 알림 없이 이 탭의 세션만 지운다
    if (isApiError(error) && error.status === 401) clearSession();
    throw error;
  }
}

export const threadAuth: ThreadAuth = {
  current() {
    watch();
    return currentKey();
  },
  resolve: resolveKey,
  send: sendAs,
};

// 세션 키가 바뀌면 그 자리에서 이전 세션의 것을 모두 비운다. 검색 화면이 떠 있지 않아도 비운다(D-6).
// 현재 위치와 기기의 비회원 기록은 남긴다
export function clearOnSessionChange(queryClient: QueryClient) {
  watch();
  observe();
  const clear = () => {
    queryClient.clear();
    searchStore.reset();
    resetThreadSession();
  };
  changeListeners.add(clear);
  return () => {
    changeListeners.delete(clear);
  };
}
