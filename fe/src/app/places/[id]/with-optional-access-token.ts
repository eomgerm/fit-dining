import {
  ACCESS_TOKEN_EXPIRED_TYPE,
  getSession,
  refresh,
  restore,
  subscribe,
  type AuthSession,
} from "@/domains/auth/api/auth-client";
import { isApiError } from "@/shared/api/api-error";

// 장소 상세의 리뷰 목록만 쓰는 선택 인증이라 app 계층에 둔다. 로그인이 필요한 요청은 인증 도메인의 withAccessToken을 쓴다

function isExpired(error: unknown) {
  return (
    isApiError(error) &&
    error.status === 401 &&
    error.problem?.type === ACCESS_TOKEN_EXPIRED_TYPE
  );
}

// 그사이 다른 요청이 이미 갱신했으면 새 세션을 그대로 쓴다
async function renewed(current: AuthSession) {
  const latest = getSession();
  return latest && latest.accessToken !== current.accessToken
    ? latest
    : refresh();
}

const RESTORE_TIMEOUT_MS = 3_000;

// 세션이 없다고 확인했거나 서버가 거부한 AT는 인증 상태가 바뀔 때까지 기억해,
// 비로그인 사용자가 목록 페이지마다 세션 갱신을 시도하지 않게 한다(D-42)
let signedOut = false;
let rejectedToken: string | undefined;
let watching = false;

const isUnauthorized = (error: unknown) =>
  isApiError(error) && error.status === 401;

function optionalSession() {
  if (!watching) {
    watching = true;
    subscribe(() => {
      signedOut = false;
      rejectedToken = undefined;
    });
  }
  const session = getSession();
  if (session || signedOut) return Promise.resolve(session);
  return new Promise<AuthSession | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), RESTORE_TIMEOUT_MS);
    restore()
      .then(resolve, (error) => {
        if (isUnauthorized(error)) signedOut = true;
        resolve(null);
      })
      .finally(() => clearTimeout(timer));
  });
}

// 목록처럼 로그인이 선택인 리뷰 요청(D-42). 세션이 있으면 AT를 붙이고 없으면 AT 없이 보낸다.
// AT가 만료됐으면 한 번 갱신해 다시 보내고, 갱신에 실패했거나 AT가 거부되면 AT 없이 다시 보낸다
export async function withOptionalAccessToken<T>(
  send: (accessToken?: string) => Promise<T>,
): Promise<T> {
  const current = await optionalSession();
  if (!current || current.accessToken === rejectedToken) return send();
  try {
    return await send(current.accessToken);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    if (!isExpired(error)) {
      rejectedToken = current.accessToken;
      return send();
    }
    const next = await renewed(current).catch(() => null);
    if (!next) return send();
    try {
      return await send(next.accessToken);
    } catch (retryError) {
      if (!isUnauthorized(retryError)) throw retryError;
      rejectedToken = next.accessToken;
      return send();
    }
  }
}
