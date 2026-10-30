// Chrome·삼성 인터넷이 설치할 수 있을 때 보내는 이벤트. 표준이 아니라 DOM 타입에 없다
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallSnapshot = { canPrompt: boolean; installed: boolean };

let deferred: BeforeInstallPromptEvent | null = null;
let snapshot: InstallSnapshot = { canPrompt: false, installed: false };
const listeners = new Set<() => void>();

function update(next: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

// 이벤트는 페이지를 연 직후 한 번만 온다. 컴포넌트가 마운트되기 전에 놓치지 않도록 모듈을 읽을 때 리스너를 단다
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // 브라우저 기본 설치 안내(미니 인포바) 대신 우리 모달·배너를 쓴다
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    update({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    update({ canPrompt: false, installed: true });
  });
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const installSnapshot = () => snapshot;

// 보관한 이벤트로 설치 창을 띄운다. 이벤트는 한 번만 쓸 수 있어 결과와 관계없이 비운다
export async function promptInstall() {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  update({ canPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
