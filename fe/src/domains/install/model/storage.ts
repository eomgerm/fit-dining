// 1-01a 모달은 한 번만 띄운다(다음 방문에도). 4-01b 배너는 ×로 닫으면 이번 방문 동안만 숨긴다
const INTRO_KEY = "fd.install.intro-seen.v1";
const BANNER_KEY = "fd.install.banner-closed.v1";
const listeners = new Set<() => void>();
// 저장소를 못 쓰는 브라우저(쿠키 차단 등)에서도 이번 페이지 동안은 기억한다.
// 기억하지 못하면 [웹에서 계속하기]로 다시 누른 버튼을 또 가로채 안내가 끝없이 뜬다
const remembered = new Set<string>();

function read(storage: () => Storage, key: string) {
  if (remembered.has(key)) return true;
  try {
    return storage().getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(storage: () => Storage, key: string) {
  try {
    storage().setItem(key, "1");
  } catch {
    remembered.add(key);
  }
  listeners.forEach((listener) => listener());
}

// 같은 화면에서 모달을 본 직후나 배너를 닫은 직후 배너를 다시 그리도록 알린다
export function subscribeInstallStorage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const introSeen = () => read(() => localStorage, INTRO_KEY);
export const markIntroSeen = () => write(() => localStorage, INTRO_KEY);
export const bannerClosed = () => read(() => sessionStorage, BANNER_KEY);
export const closeBanner = () => write(() => sessionStorage, BANNER_KEY);

// 1-01a에서 가이드로 갔다가 돌아오면 최초화면 대신 누른 버튼이 하던 곳(온보딩·로그인)으로 바로 보낸다
const RESUME_KEY = "fd.install.resume.v1";
export type IntroAction = "start" | "login";

export function rememberResume(from: IntroAction) {
  try {
    sessionStorage.setItem(RESUME_KEY, from);
  } catch {
    /* Storage may be disabled. */
  }
}
export function takeResume(): IntroAction | undefined {
  try {
    const value = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    if (value === "start" || value === "login") return value;
  } catch {
    /* Storage may be disabled. */
  }
}
