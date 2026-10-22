import { isApiError } from "@/shared/api/api-error";

// 등록 실패 안내 문구. 1차 후속에서 7-E05(서버)·7-E06(연결) 다이얼로그로 바뀐다(D-30)
export function submitErrorMessage(error: unknown) {
  if (isApiError(error) && error.kind !== "http") {
    return "인터넷 연결을 확인하고 다시 시도해 주세요. 입력한 내용은 그대로 있어요.";
  }
  if (isApiError(error) && (error.status ?? 0) < 500) {
    return "입력한 내용을 확인해 주세요.";
  }
  return "지금은 등록하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
