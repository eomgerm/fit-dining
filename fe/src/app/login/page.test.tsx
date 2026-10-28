// @vitest-environment jsdom
import {
  act,
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
it("링크 버튼에 nativeButton 경고가 없다", async () => {
  const error = vi.spyOn(console, "error");
  const warn = vi.spyOn(console, "warn");
  try {
    mocks.restore.mockRejectedValueOnce(new Error("unauthenticated"));
    render(
      <ToastProvider>
        <LoginPage />
      </ToastProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("이메일") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(
      screen.getByRole("link", { name: "로그인 닫기" }).getAttribute("href"),
    ).toBe("/");
    expect(
      screen
        .getByRole("link", { name: "이메일로 가입하기" })
        .getAttribute("href"),
    ).toBe("/signup");
    expect(
      [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
    ).not.toContain("nativeButton");
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
it("이메일과 비밀번호를 모두 입력해야 로그인 버튼을 활성화한다", async () => {
  mocks.restore.mockRejectedValueOnce(new Error("unauthenticated"));
  render(
    <ToastProvider>
      <LoginPage />
    </ToastProvider>,
  );
  await waitFor(() =>
    expect((screen.getByLabelText("이메일") as HTMLInputElement).disabled).toBe(
      false,
    ),
  );
  const button = screen.getByRole("button", {
    name: "로그인",
  }) as HTMLButtonElement;
  const email = screen.getByLabelText("이메일");
  const password = screen.getByLabelText("비밀번호");
  expect(button.disabled).toBe(true);
  fireEvent.change(email, { target: { value: "user@example.com" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(password, { target: { value: "password1" } });
  expect(button.disabled).toBe(false);
  fireEvent.change(email, { target: { value: "" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(email, { target: { value: "user@example.com" } });
  expect(button.disabled).toBe(false);
  fireEvent.change(password, { target: { value: "" } });
  expect(button.disabled).toBe(true);
  expect(mocks.login).not.toHaveBeenCalled();
});
it("인증 상태 확인과 로그인 요청 중에는 로그인 버튼을 비활성화한다", async () => {
  let rejectRestore!: (reason: Error) => void;
  let resolveLogin!: () => void;
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRestore = reject;
      }),
  );
  mocks.login.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveLogin = resolve;
      }),
  );
  render(
    <ToastProvider>
      <LoginPage />
    </ToastProvider>,
  );
  expect(
    (
      screen.getByRole("button", {
        name: "로그인 확인 중",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () => rejectRestore(new Error("unauthenticated")));
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "password1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(mocks.login).toHaveBeenCalledWith("user@example.com", "password1");
  expect(
    (
      screen.getByRole("button", {
        name: "로그인 확인 중",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () => resolveLogin());
});
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
