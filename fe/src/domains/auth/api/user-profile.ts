import { clearSession, endSession, restore } from "./auth-client";
import { withAccessToken } from "./with-access-token";
import { request } from "@/shared/api/client";
import { isApiError } from "@/shared/api/api-error";
export type UserProfile = {
  userId: string;
  nickname: string;
  loginMethod: "email" | "google" | "kakao" | "naver";
};
const userPath = (userId: string) => `/v1/users/${encodeURIComponent(userId)}`;
export async function getUserProfile(): Promise<UserProfile> {
  try {
    const current = await restore();
    return await withAccessToken((token) =>
      request<UserProfile>(userPath(current.userId), {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  } catch (error) {
    if (isApiError(error) && error.status === 401) clearSession();
    throw error;
  }
}
// 회원 탈퇴. 성공하면 이 탭과 다른 탭의 세션을 비운다. 401(세션 없음·갱신 실패)이면 세션을 비우고 오류를 던진다
export async function withdraw(): Promise<void> {
  try {
    const current = await restore();
    await withAccessToken((token) =>
      request<void>(userPath(current.userId), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  } catch (error) {
    if (isApiError(error) && error.status === 401) clearSession();
    throw error;
  }
  endSession();
}
