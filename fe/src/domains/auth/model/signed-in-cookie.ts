import { hasFlagCookie, setFlagCookie } from "@/shared/lib/flag-cookie";

// 로그인 세션이 있다는 표시. 홈(/)이 첫 HTML부터 검색 홈을 고르게 한다(docs/onboarding/01_onboarding.md FE 흐름).
// 세션 그 자체가 아니다. 인증은 지금처럼 메모리의 AT와 BE의 RT 쿠키로 한다
export const SIGNED_IN_COOKIE = "fd_signed_in";

// 이 탭에서 표시를 심은 횟수
let marks = 0;
export const signedInMarks = () => marks;

// sessionExpiresAt은 BE가 준 RT 묶음 만료(epoch 초)다
export function markSignedIn(sessionExpiresAt: number, now = Date.now()) {
  marks += 1;
  setFlagCookie(SIGNED_IN_COOKIE, sessionExpiresAt - now / 1000);
}

// since(signedInMarks 값)를 주면 그 뒤에 새로 심은 표시는 지우지 않는다.
// 갱신 401이 기다리는 사이 소셜 버튼이 심은 표시를 지우면 돌아온 홈이 온보딩을 먼저 그린다
export function clearSignedIn(since?: number) {
  if (since !== undefined && since !== marks) return;
  setFlagCookie(SIGNED_IN_COOKIE, 0);
}

export const isMarkedSignedIn = () => hasFlagCookie(SIGNED_IN_COOKIE);
