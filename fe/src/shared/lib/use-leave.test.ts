// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useLeave } from "./use-leave";

const mocks = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));

function sessionHistory(paths: string[], index = paths.length - 1) {
  vi.stubGlobal("navigation", {
    currentEntry: { index },
    entries: () => paths.map((path) => ({ url: `https://fit.test${path}` })),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useLeave", () => {
  it("바로 앞 기록이 상위 화면이면 그리로 돌아간다", () => {
    sessionHistory(["/", "/m", "/m/CODE"]);
    renderHook(() => useLeave("/m")).result.current();
    expect(mocks.back).toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("바로 앞 기록이 다른 화면이면 지금 기록을 상위 화면으로 바꾼다", () => {
    sessionHistory(["/", "/m", "/m/CODE", "/m"]);
    renderHook(() => useLeave("/")).result.current();
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("앞으로 가기 기록만 있는 첫 기록에서도 상위 화면으로 바꾼다", () => {
    sessionHistory(["/m/CODE", "/m/CODE/join"], 0);
    renderHook(() => useLeave("/m")).result.current();
    expect(mocks.replace).toHaveBeenCalledWith("/m");
  });

  it("브라우저가 앞 기록의 주소를 숨기면 상위 화면으로 바꾼다", () => {
    vi.stubGlobal("navigation", {
      currentEntry: { index: 1 },
      entries: () => [{ url: null }, { url: "https://fit.test/m" }],
    });
    renderHook(() => useLeave("/")).result.current();
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.back).not.toHaveBeenCalled();
  });

  it("Navigation API가 없으면 상위 화면으로 바꾼다", () => {
    renderHook(() => useLeave("/m")).result.current();
    expect(mocks.replace).toHaveBeenCalledWith("/m");
    expect(mocks.back).not.toHaveBeenCalled();
  });
});
