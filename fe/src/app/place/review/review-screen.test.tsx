// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { takeLoginReturn } from "../../login-return";
import { useSignedIn } from "./review-screen";

const mocks = vi.hoisted(() => ({ restore: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ restore: mocks.restore }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/place/review/edit?id=3&review=7");
});

describe("useSignedIn", () => {
  it("로그인하지 않았으면 로그인 화면으로 바꿔치기하고 이 화면 주소를 남긴다(D-48)", async () => {
    mocks.restore.mockRejectedValue(new Error("unauthenticated"));

    renderHook(() => useSignedIn());

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    expect(takeLoginReturn()).toBe("/place/review/edit?id=3&review=7");
  });

  it("로그인했으면 주소를 남기지 않는다", async () => {
    mocks.restore.mockResolvedValue({});

    const { result } = renderHook(() => useSignedIn());

    await waitFor(() => expect(result.current.signedIn).toBe(true));
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(takeLoginReturn()).toBeUndefined();
  });
});
