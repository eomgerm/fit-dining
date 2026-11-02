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
import { savedViewState } from "@/domains/place/ui/saved-view-state";
import { ApiError } from "@/shared/api/api-error";
import MyPage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), back: vi.fn(), push: vi.fn() },
  profile: vi.fn(),
  logout: vi.fn(),
  toast: vi.fn(),
  session: { userId: "u1" } as { userId: string } | null,
  listener: undefined as (() => void) | undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/shared/ui/overlay/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/domains/auth/api/user-profile", () => ({
  getUserProfile: mocks.profile,
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  getSession: () => mocks.session,
  logout: mocks.logout,
  subscribe: (listener: () => void) => {
    mocks.listener = listener;
    return () => {
      mocks.listener = undefined;
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "u1" };
  mocks.profile.mockResolvedValue({
    userId: "u1",
    nickname: "라테한잔",
    loginMethod: "email",
  });
  mocks.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);
it.each([
  ["email", "이메일로 로그인했어요"],
  ["kakao", "카카오 계정으로 로그인했어요"],
  ["naver", "네이버 계정으로 로그인했어요"],
  ["google", "구글 계정으로 로그인했어요"],
])("shows profile for %s", async (loginMethod, message) => {
  mocks.profile.mockResolvedValue({
    userId: "u1",
    nickname: "라테한잔",
    loginMethod,
  });
  render(<MyPage />);
  expect(await screen.findByText("라테한잔")).toBeTruthy();
  expect(screen.getByText(message)).toBeTruthy();
});
it("redirects on 401", async () => {
  mocks.profile.mockRejectedValue(
    new ApiError("http", "unauthorized", { status: 401 }),
  );
  render(<MyPage />);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith("/login"),
  );
});
it("redirects when restoration has no session", async () => {
  mocks.session = null;
  mocks.profile.mockRejectedValue(new Error("restore failed"));
  render(<MyPage />);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith("/login"),
  );
});
it("shows other profile errors inline", async () => {
  mocks.profile.mockRejectedValue(
    new ApiError("http", "server", { status: 503 }),
  );
  render(<MyPage />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.router.replace).not.toHaveBeenCalled();
});
it("logs out to home without a login redirect and disables the button", async () => {
  let finish!: () => void;
  mocks.logout.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          mocks.session = null;
          mocks.listener?.();
          resolve();
        };
      }),
  );
  render(<MyPage />);
  const button = await screen.findByRole("button", { name: "로그아웃" });
  fireEvent.click(button);
  expect(button).toHaveProperty("disabled", true);
  await act(async () => finish());
  expect(mocks.router.replace).toHaveBeenCalledWith("/");
  expect(mocks.router.replace).not.toHaveBeenCalledWith("/login");
});
it("shows logout failure and allows retry", async () => {
  mocks.logout.mockRejectedValue(new Error("offline"));
  render(<MyPage />);
  const button = await screen.findByRole("button", { name: "로그아웃" });
  fireEvent.click(button);
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      "로그아웃하지 못했어요. 다시 시도해 주세요.",
    ),
  );
  expect(button).toHaveProperty("disabled", false);
});
it("treats logout 401 as success without a failure toast", async () => {
  mocks.logout.mockImplementation(async () => {
    mocks.session = null;
    mocks.listener?.();
    throw new ApiError("http", "expired", { status: 401 });
  });
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/"));
  expect(mocks.router.replace).not.toHaveBeenCalledWith("/login");
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("'저장한 장소'는 토스트 없이 저장한 장소 화면을 내 정보에서 연 것으로 연다", async () => {
  savedViewState.clear();
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "저장한 장소" }));
  expect(mocks.router.push).toHaveBeenCalledWith("/?view=saved");
  expect(savedViewState.entry()).toEqual({ from: "my" });
  expect(mocks.toast).not.toHaveBeenCalled();
});
it.each([
  ["이용약관", "/terms"],
  ["개인정보처리방침", "/privacy"],
])("'%s'는 토스트 없이 %s로 이동한다", async (name, href) => {
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name }));
  expect(mocks.router.push).toHaveBeenCalledWith(href);
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("shows preparation toast for 탈퇴하기", async () => {
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "탈퇴하기" }));
  expect(mocks.toast).toHaveBeenCalledWith("준비 중이에요");
});
it("redirects when another tab clears the session", async () => {
  render(<MyPage />);
  await screen.findByText("라테한잔");
  act(() => {
    mocks.session = null;
    mocks.listener?.();
  });
  expect(mocks.router.replace).toHaveBeenCalledWith("/login");
  expect(screen.queryByText("라테한잔")).toBeNull();
});
