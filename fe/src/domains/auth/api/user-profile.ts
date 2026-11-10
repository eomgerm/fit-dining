import { endSession } from "./auth-client";
import { request } from "@/shared/api/client";
import { authenticated } from "./authenticated";
export type UserProfile = {
  userId: string;
  nickname: string;
  loginMethod: "email" | "google" | "kakao" | "naver";
};
const userPath = (userId: string) => `/v1/users/${encodeURIComponent(userId)}`;
export function getUserProfile(): Promise<UserProfile> {
  return authenticated((session) =>
    request<UserProfile>(userPath(session.userId), {}),
  );
}
// 성공 시 다른 탭에도 종료를 알린다. 401 처리는 인증 래퍼와 공유한다.
export async function withdraw(): Promise<void> {
  await authenticated((session) =>
    request<void>(userPath(session.userId), { method: "DELETE" }),
  );
  endSession();
}
