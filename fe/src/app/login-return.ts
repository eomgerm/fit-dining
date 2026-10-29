// 북마크의 로그인 안내에서 [로그인]을 고른 화면 주소(bookmark D-8). 이메일·소셜 로그인과 가입 모두 같은 탭에서
// 결국 홈(/)에 도착하므로, 로그인 화면을 고치지 않고 홈 도착 때 한 번 읽어 그 화면으로 보낸다
const KEY = "fitdining:login-return";
const MAX_AGE_MS = 10 * 60 * 1000;

export function rememberLoginReturn(path: string, now = Date.now()) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {}
}

// 남은 주소를 지우고, 10분이 지나지 않은 같은 출처 경로일 때만 돌려준다
export function takeLoginReturn(now = Date.now()) {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== "string" || typeof at !== "number") return;
    if (at > now || now - at > MAX_AGE_MS) return;
    return sameOriginPath(path);
  } catch {
    return;
  }
}

// "//host"나 "/\host"는 브라우저가 다른 출처로 해석하므로 버린다
function sameOriginPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\"))
    return;
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) return;
  return `${url.pathname}${url.search}${url.hash}`;
}
