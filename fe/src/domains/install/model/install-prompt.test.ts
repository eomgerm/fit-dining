// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Choice = "accepted" | "dismissed";

function fireBeforeInstallPrompt(outcome: Choice) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

// 모듈이 읽힐 때 window에 리스너를 다는 구조라 테스트마다 새로 읽는다
async function load() {
  vi.resetModules();
  return import("./install-prompt");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("설치 프롬프트", () => {
  it("이벤트가 오기 전에는 띄울 수 없다", async () => {
    const store = await load();
    expect(store.installSnapshot()).toEqual({
      canPrompt: false,
      installed: false,
    });
    expect(await store.promptInstall()).toBe(false);
  });

  it("브라우저 기본 안내를 막고 이벤트를 보관한다", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribeInstall(listener);
    const { event } = fireBeforeInstallPrompt("dismissed");
    expect(event.defaultPrevented).toBe(true);
    expect(store.installSnapshot().canPrompt).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it("설치 창은 한 번만 띄우고 결과를 돌려준다", async () => {
    const store = await load();
    const { prompt } = fireBeforeInstallPrompt("accepted");
    expect(await store.promptInstall()).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(store.installSnapshot().canPrompt).toBe(false);
    expect(await store.promptInstall()).toBe(false);
  });

  it("거절해도 보관한 이벤트는 비운다", async () => {
    const store = await load();
    fireBeforeInstallPrompt("dismissed");
    expect(await store.promptInstall()).toBe(false);
    expect(store.installSnapshot().canPrompt).toBe(false);
  });

  it("설치가 끝나면 설치됨으로 바꾼다", async () => {
    const store = await load();
    fireBeforeInstallPrompt("accepted");
    window.dispatchEvent(new Event("appinstalled"));
    expect(store.installSnapshot()).toEqual({
      canPrompt: false,
      installed: true,
    });
  });
});
