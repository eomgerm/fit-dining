// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberResume, takeResume } from "../model/storage";
import { InstallGuide } from "./install-guide";

const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

// 최초화면에서 가이드로 온 기록을 남긴다
beforeEach(() => window.history.pushState(null, "", "/install/android"));

const back = () =>
  fireEvent.click(screen.getByRole("button", { name: "이전" }));

describe("가이드 [이전]", () => {
  it("[시작하기]에서 왔으면 이전 화면으로 돌아가 온보딩이 이어 받게 둔다", () => {
    rememberResume("start");
    render(<InstallGuide steps={[]} />);
    back();
    expect(mocks.router.back).toHaveBeenCalled();
    expect(takeResume()).toBe("start");
  });

  it("[기존 계정으로 로그인]에서 왔으면 최초화면을 거치지 않고 로그인 화면으로 간다", () => {
    rememberResume("login");
    render(<InstallGuide steps={[]} />);
    back();
    expect(mocks.router.replace).toHaveBeenCalledWith("/login");
    expect(mocks.router.back).not.toHaveBeenCalled();
    expect(takeResume()).toBeUndefined();
  });
});
