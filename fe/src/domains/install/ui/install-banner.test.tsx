// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markIntroSeen } from "../model/storage";
import { InstallBanner } from "./install-banner";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  pathname: "/",
  standalone: false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
}));

beforeEach(() => {
  mocks.pathname = "/";
  mocks.standalone = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: mocks.standalone })),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const banner = () =>
  screen.queryByRole("complementary", { name: "홈 화면 추가 안내" });

describe("홈 화면 추가 배너", () => {
  it("모달을 보기 전에는 띄우지 않는다", () => {
    render(<InstallBanner />);
    expect(banner()).toBeNull();
  });

  it("모달을 본 뒤로 브라우저 화면 맨 위에 떠 있게 띄운다", () => {
    markIntroSeen();
    render(<InstallBanner />);
    // 페이지 배치를 밀지 않도록 흐름 밖(fixed)에 둔다
    expect(banner()?.className).toContain("fixed");
  });

  it("같은 화면에서 모달을 보면 바로 띄운다", () => {
    render(<InstallBanner />);
    expect(banner()).toBeNull();
    act(() => markIntroSeen());
    expect(banner()).not.toBeNull();
  });

  it("×로 닫으면 이번 방문 동안 숨긴다", () => {
    markIntroSeen();
    render(<InstallBanner />);
    fireEvent.click(screen.getByRole("button", { name: "배너 닫기" }));
    expect(banner()).toBeNull();
    cleanup();
    render(<InstallBanner />);
    expect(banner()).toBeNull();
  });

  it("홈 화면에서 연 앱에서는 띄우지 않는다", () => {
    markIntroSeen();
    mocks.standalone = true;
    render(<InstallBanner />);
    expect(banner()).toBeNull();
  });

  it("가이드 화면에서는 띄우지 않는다", () => {
    markIntroSeen();
    mocks.pathname = "/install/ios";
    render(<InstallBanner />);
    expect(banner()).toBeNull();
  });

  it("[추가하기]는 설치 창이 없으면 가이드로 간다", () => {
    markIntroSeen();
    render(<InstallBanner />);
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));
    expect(mocks.router.push).toHaveBeenCalledWith("/install/android");
  });
});

describe("설치 창을 띄울 수 있을 때", () => {
  function fireBeforeInstallPrompt(prompt: () => Promise<void>) {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it("[추가하기]는 가이드 대신 브라우저 설치 창을 띄운다", async () => {
    markIntroSeen();
    render(<InstallBanner />);
    const prompt = vi.fn(async () => {});
    fireBeforeInstallPrompt(prompt);
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("설치 창을 띄우지 못하면 가이드로 간다", async () => {
    markIntroSeen();
    render(<InstallBanner />);
    fireBeforeInstallPrompt(async () => {
      throw new Error("NotAllowedError");
    });
    fireEvent.click(screen.getByRole("button", { name: "추가하기" }));
    await waitFor(() =>
      expect(mocks.router.push).toHaveBeenCalledWith("/install/android"),
    );
  });
});
