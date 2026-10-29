import { isApiError } from "@/shared/api/api-error";

// 신고 실패(6-E06)의 토스트 문구와 시트를 닫을지. 연결 문제나 서버 오류는 시트를 두고 다시 보낼 수 있게 한다
export function reportFailure(error: unknown): {
  message: string;
  close: boolean;
} {
  if (isApiError(error) && error.kind === "network") {
    return { message: "인터넷에 연결되어 있지 않아요", close: false };
  }
  const status = isApiError(error) ? error.status : undefined;
  switch (status) {
    case 401:
      return {
        message: "로그인이 끝났어요. 다시 로그인해 주세요",
        close: true,
      };
    case 404:
      return { message: "이미 삭제된 리뷰예요", close: true };
    case 409:
      return { message: "이미 신고한 리뷰예요", close: true };
  }
  if (status !== undefined && status < 500) {
    return { message: "이 리뷰는 신고할 수 없어요", close: true };
  }
  return {
    message: "신고하지 못했어요. 잠시 후 다시 시도해 주세요",
    close: false,
  };
}
