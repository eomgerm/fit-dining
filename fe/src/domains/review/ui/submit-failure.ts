import { isApiError } from "@/shared/api/api-error";

// 등록 실패 안내의 종류(D-41). 없는 장소(404)만 빼고 입력은 그대로 남는다
export type SubmitFailure =
  | "offline" // 7-E06
  | "server" // 7-E05
  | "duplicate" // 409
  | "signedOut" // AT 갱신까지 실패한 401
  | "placeNotFound" // 404. 쓰는 동안 장소가 없어졌다
  | "invalid"; // 그 밖의 4xx. 작성 화면 데이터가 낡았을 수 있다

export function submitFailure(error: unknown): SubmitFailure {
  if (!isApiError(error)) return "server";
  if (error.kind === "network") return "offline";
  if (error.kind === "timeout") return "server";
  if (error.status === 409) return "duplicate";
  if (error.status === 401) return "signedOut";
  if (error.status === 404) return "placeNotFound";
  if ((error.status ?? 500) < 500) return "invalid";
  return "server";
}
