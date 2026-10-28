// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AuthDemoPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/domains/auth/api/auth-client", async (original) => ({
  ...(await original<typeof import("@/domains/auth/api/auth-client")>()),
  restore: vi.fn().mockRejectedValue(new Error("offline")),
}));
afterEach(cleanup);
it("로그인 링크에 nativeButton 경고가 없다", async () => {
  const error = vi.spyOn(console, "error");
  const warn = vi.spyOn(console, "warn");
  try {
    render(<AuthDemoPage />);
    await waitFor(() => expect(screen.getByText("offline")).toBeTruthy());
    expect(
      screen.getByRole("link", { name: "로그인 페이지" }).getAttribute("href"),
    ).toBe("/login");
    expect(
      [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
    ).not.toContain("nativeButton");
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
