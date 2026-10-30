// 홈 화면 추가 안내를 고를 때만 쓰는 구분이다. iOS가 아니면 Chrome 메뉴 경로(갤럭시 안내)를 보여 준다
export type InstallPlatform = "ios" | "android";

export function installPlatform(
  userAgent: string,
  maxTouchPoints: number,
): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  // iPadOS Safari는 Mac과 같은 UA를 보내므로 터치 지원으로 가른다
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "android";
}
