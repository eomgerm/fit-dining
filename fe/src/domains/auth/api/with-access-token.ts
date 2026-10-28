import {
  ACCESS_TOKEN_EXPIRED_TYPE,
  getSession,
  refresh,
  restore,
} from "./auth-client";
import { isApiError } from "@/shared/api/api-error";

// 로그인이 필요한 리뷰 요청에 AT를 붙인다. AT가 만료됐으면 한 번 갱신해 다시 보낸다.
// 세션이 없거나 갱신에 실패하면 인증 클라이언트의 401 오류를 그대로 던진다
export async function withAccessToken<T>(
  send: (accessToken: string) => Promise<T>,
): Promise<T> {
  const current = await restore();
  try {
    return await send(current.accessToken);
  } catch (error) {
    if (
      !isApiError(error) ||
      error.status !== 401 ||
      error.problem?.type !== ACCESS_TOKEN_EXPIRED_TYPE
    ) {
      throw error;
    }
    // 그사이 다른 요청이 이미 갱신했으면 새 AT를 그대로 쓴다
    const latest = getSession();
    const next =
      latest && latest.accessToken !== current.accessToken
        ? latest
        : await refresh();
    return send(next.accessToken);
  }
}
