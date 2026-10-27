// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/overlay/toast";
import LoginPage from "./page";
const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  restore: vi.fn(),
  login: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/domains/auth/api/auth-client", async (original) => ({
  ...(await original<typeof import("@/domains/auth/api/auth-client")>()),
  restore: mocks.restore,
  login: mocks.login,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("이미 로그인했다면 홈으로 이동한다", async () => {
  mocks.restore.mockResolvedValueOnce({ userId: "user-1" });
  render(
    <ToastProvider>
      <LoginPage />
    </ToastProvider>,
  );
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/"));
});
it("로그인 성공 후 홈으로 이동한다", async () => {
  mocks.restore.mockRejectedValueOnce(new Error("unauthenticated"));
  mocks.login.mockResolvedValueOnce({ userId: "user-1" });
  render(
    <ToastProvider>
      <LoginPage />
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "이메일" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "password1" },
  });
  fireEvent.submit(screen.getByLabelText("이메일").closest("form")!);
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/"));
});
