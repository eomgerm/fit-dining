import { hasFlagCookie, setFlagCookie } from "@/shared/lib/flag-cookie";

// 로그인 세션이 있다는 표시. 홈(/)이 첫 HTML부터 검색 홈을 고르게 한다(docs/onboarding/01_onboarding.md FE 흐름).
// 세션 그 자체가 아니다. 인증은 BE의 HttpOnly 세션 쿠키로 한다
export const SIGNED_IN_COOKIE = "fd_signed_in";

// 표시를 심을 때마다 바꾸는 값. 쿠키처럼 모든 탭이 같이 보도록 localStorage에 둔다.
// 저장소를 못 쓰면 이 탭에서 센 값으로 대신한다
const MARK_ITEM = "fd.signed-in.mark.v1";
let localMarks = 0;
export function signedInMarks() {
  try {
    return localStorage.getItem(MARK_ITEM) ?? "";
  } catch {
    return `local:${localMarks}`;
  }
}

// sessionExpiresAt은 BE가 준 세션 절대 만료(epoch 초)다
export function markSignedIn(sessionExpiresAt: number, now = Date.now()) {
  localMarks += 1;
  try {
    localStorage.setItem(MARK_ITEM, `${now}-${Math.random()}`);
  } catch {
    /* 이 탭에서 센 값만 바뀐다 */
  }
  setFlagCookie(SIGNED_IN_COOKIE, sessionExpiresAt - now / 1000);
}

// since(signedInMarks 값)를 주면 그 뒤에 어느 탭에서든 새로 심은 표시는 지우지 않는다.
// 갱신 401이 기다리는 사이 소셜 버튼이 심은 표시를 지우면 돌아온 홈이 온보딩을 먼저 그린다
export function clearSignedIn(since?: string) {
  if (since !== undefined && since !== signedInMarks()) return;
  setFlagCookie(SIGNED_IN_COOKIE, 0);
}

export const isMarkedSignedIn = () => hasFlagCookie(SIGNED_IN_COOKIE);
