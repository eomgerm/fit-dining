// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { savedViewState } from "@/domains/place/ui/saved-view-state";
import { ApiError } from "@/shared/api/api-error";
import MyPage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), back: vi.fn(), push: vi.fn() },
  profile: vi.fn(),
  logout: vi.fn(),
  withdraw: vi.fn(),
  toast: vi.fn(),
  session: { userId: "u1" } as { userId: string } | null,
  listener: undefined as (() => void) | undefined,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/shared/ui/overlay/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/domains/auth/api/user-profile", () => ({
  getUserProfile: mocks.profile,
  withdraw: mocks.withdraw,
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
  mocks.withdraw.mockResolvedValue(undefined);
});
// 메뉴 버튼으로 확인 창을 열고 창을 돌려준다
async function openDialog(menu: string) {
  fireEvent.click(await screen.findByRole("button", { name: menu }));
  return screen.findByRole("alertdialog");
}
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
it("asks before logging out and cancels without calling logout", async () => {
  render(<MyPage />);
  const dialog = await openDialog("로그아웃");
  expect(within(dialog).getByText("로그아웃할까요?")).toBeTruthy();
  expect(mocks.logout).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mocks.logout).not.toHaveBeenCalled();
});
it("logs out to home without a login redirect and disables the buttons", async () => {
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
  const dialog = await openDialog("로그아웃");
  const confirm = within(dialog).getByRole("button", { name: "로그아웃" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.logout).toHaveBeenCalledTimes(1);
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  expect(
    within(dialog)
      .getByRole("button", { name: "취소" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await act(async () => finish());
  expect(mocks.router.replace).toHaveBeenCalledWith("/");
  expect(mocks.router.replace).not.toHaveBeenCalledWith("/login");
  // 이동이 끝나기 전까지 모달은 막힌 채로 남고, 다시 눌러도 요청하지 않는다
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(confirm);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(mocks.logout).toHaveBeenCalledTimes(1);
});
it("shows logout failure, closes the dialog and allows retry", async () => {
  mocks.logout.mockRejectedValue(new Error("offline"));
  render(<MyPage />);
  const dialog = await openDialog("로그아웃");
  fireEvent.click(within(dialog).getByRole("button", { name: "로그아웃" }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      "로그아웃하지 못했어요. 다시 시도해 주세요.",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await openDialog("로그아웃");
});
it("treats logout 401 as success without a failure toast", async () => {
  mocks.logout.mockImplementation(async () => {
    mocks.session = null;
    mocks.listener?.();
    throw new ApiError("http", "expired", { status: 401 });
  });
  render(<MyPage />);
  const dialog = await openDialog("로그아웃");
  fireEvent.click(within(dialog).getByRole("button", { name: "로그아웃" }));
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
it("asks before withdrawing with the design copy and cancels without calling withdraw", async () => {
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  expect(within(dialog).getByText("탈퇴할까요?")).toBeTruthy();
  expect(
    within(dialog).getByText(
      "저장한 장소와 남긴 리뷰가 모두 지워지고 되돌릴 수 없어요.",
    ),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mocks.withdraw).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("withdraws to home with a toast, disabling the buttons while pending", async () => {
  let finish!: () => void;
  mocks.withdraw.mockImplementation(
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
  const dialog = await openDialog("탈퇴하기");
  const confirm = within(dialog).getByRole("button", { name: "탈퇴" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.withdraw).toHaveBeenCalledTimes(1);
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  expect(
    within(dialog)
      .getByRole("button", { name: "취소" })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  expect(within(dialog).getByRole("status").textContent).toBe(
    "탈퇴하고 있어요",
  );
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await act(async () => finish());
  expect(mocks.router.replace).toHaveBeenCalledWith("/");
  expect(mocks.router.replace).not.toHaveBeenCalledWith("/login");
  expect(mocks.toast).toHaveBeenCalledWith("탈퇴했어요");
  // 이동이 끝나기 전까지 모달은 막힌 채로 남고, 다시 눌러도 요청하지 않는다
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(confirm);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(mocks.withdraw).toHaveBeenCalledTimes(1);
});
it("sends withdraw 401 to login", async () => {
  mocks.withdraw.mockImplementation(async () => {
    mocks.session = null;
    mocks.listener?.();
    throw new ApiError("http", "unauthorized", { status: 401 });
  });
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  fireEvent.click(within(dialog).getByRole("button", { name: "탈퇴" }));
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith("/login"),
  );
  expect(mocks.toast).not.toHaveBeenCalled();
});
it("shows withdraw failure and closes the dialog", async () => {
  mocks.withdraw.mockRejectedValue(
    new ApiError("http", "server", { status: 503 }),
  );
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  fireEvent.click(within(dialog).getByRole("button", { name: "탈퇴" }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      "탈퇴하지 못했어요. 다시 시도해 주세요.",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(mocks.router.replace).not.toHaveBeenCalled();
});
it("sends to login when another tab logged out during a failed withdraw", async () => {
  mocks.withdraw.mockImplementation(async () => {
    mocks.session = null;
    mocks.listener?.();
    throw new ApiError("http", "server", { status: 503 });
  });
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  fireEvent.click(within(dialog).getByRole("button", { name: "탈퇴" }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      "탈퇴하지 못했어요. 다시 시도해 주세요.",
    ),
  );
  expect(mocks.router.replace).toHaveBeenCalledWith("/login");
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
