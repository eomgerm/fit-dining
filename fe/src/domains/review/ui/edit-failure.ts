import { isApiError } from "@/shared/api/api-error";

// 내 리뷰 수정·삭제 실패의 종류(D-44)
export type EditFailure =
  | "offline"
  | "server" // 6-E07
  | "signedOut" // AT 갱신까지 실패한 401
  | "notFound" // 404. 다른 창에서 이미 지웠다
  | "forbidden" // 403. 다른 창에서 다른 계정으로 로그인했다
  | "invalid"; // 그 밖의 4xx

export function editFailure(error: unknown): EditFailure {
  if (!isApiError(error)) return "server";
  if (error.kind === "network") return "offline";
  if (error.kind === "timeout") return "server";
  if (error.status === 401) return "signedOut";
  if (error.status === 404) return "notFound";
  if (error.status === 403) return "forbidden";
  if ((error.status ?? 500) < 500) return "invalid";
  return "server";
}

// Figma에 삭제 실패 화면이 없어 신고 실패(6-E06)처럼 토스트로 알린다
export function deleteFailureMessage(error: unknown) {
  switch (editFailure(error)) {
    case "offline":
      return "인터넷에 연결되어 있지 않아요";
    case "signedOut":
      return "로그인이 끝났어요. 다시 로그인해 주세요";
    case "notFound":
      return "이미 삭제된 리뷰예요";
    default:
      return "리뷰를 삭제하지 못했어요";
  }
}
