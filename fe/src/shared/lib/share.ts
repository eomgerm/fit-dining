export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

// 링크를 기기 공유 창으로 보낸다. 공유 창이 없거나 실패하면 링크를 복사한다(meetup AC-34).
// 사용자가 공유 창을 닫으면(AbortError) 복사하지 않는다
export async function shareLink(
  url: string,
  title?: string,
): Promise<ShareResult> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    try {
      await navigator.share({ url, title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  return (await copyLink(url)) ? "copied" : "failed";
}

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
