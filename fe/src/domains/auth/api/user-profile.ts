import { clearSession, restore } from "./auth-client";
import { withAccessToken } from "./with-access-token";
import { request } from "@/shared/api/client";
import { isApiError } from "@/shared/api/api-error";
export type UserProfile = {
  userId: string;
  nickname: string;
  loginMethod: "email" | "google" | "kakao" | "naver";
};
export async function getUserProfile(): Promise<UserProfile> {
  try {
    const current = await restore();
    return await withAccessToken((token) =>
      request<UserProfile>(`/v1/users/${encodeURIComponent(current.userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  } catch (error) {
    if (isApiError(error) && error.status === 401) clearSession();
    throw error;
  }
}
