// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { takeLoginReturn } from "../../login-return";
import { useLeave, useSignedIn } from "./review-screen";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, back: mocks.back }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/places/3/reviews/7/edit");
});

describe("useSignedIn", () => {
  it("로그인하지 않았으면 로그인 화면으로 바꿔치기하고 이 화면 주소를 남긴다(D-48)", async () => {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));

    renderHook(() => useSignedIn());

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(takeLoginReturn()).toBe("/places/3/reviews/7/edit");
  });

  it("로그인했으면 주소를 남기지 않는다", async () => {
    mocks.restore.mockResolvedValue({});

    const { result } = renderHook(() => useSignedIn());

    await waitFor(() => expect(result.current.signedIn).toBe(true));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(takeLoginReturn()).toBeUndefined();
  });
});

describe("useLeave", () => {
  it("주소로 바로 열었으면 장소 상세로 바꿔치기한다(D-32)", () => {
    const { result } = renderHook(() => useLeave());

    act(() => result.current(3));

    expect(mocks.back).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/places/3");
  });
});
