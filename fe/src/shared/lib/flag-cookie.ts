// 화면을 고르는 표시 쿠키(값 1). 비밀값도 권한도 아니라 JS가 심고, 서버(next.config의 / rewrite)가 읽는다.
// 다른 사이트 링크로 들어온 첫 요청에도 실리도록 SameSite=Lax. 0초 이하면 지운다
export function setFlagCookie(name: string, maxAgeSeconds: number) {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function hasFlagCookie(name: string) {
  return document.cookie.split("; ").includes(`${name}=1`);
}
