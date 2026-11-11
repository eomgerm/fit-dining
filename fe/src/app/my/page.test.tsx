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
import {
  GUEST_KEY,
  isGuest,
  migrateLegacyGuest,
  startAsGuest,
} from "@/domains/onboarding/model/storage";
import { savedViewState } from "@/domains/place/ui/saved-view-state";
import { ApiError } from "@/shared/api/api-error";
import MyPage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), back: vi.fn(), push: vi.fn(), refresh: vi.fn() },
  profile: vi.fn(),
  contact: vi.fn(),
  marketing: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
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
  updateContactEmail: mocks.contact,
  updateMarketingConsent: mocks.marketing,
  withdraw: mocks.withdraw,
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  getSession: () => mocks.session,
  requestEmailVerification: mocks.request,
  confirmEmailVerification: mocks.confirm,
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
  localStorage.clear();
  document.cookie = "fd_guest=; Path=/; Max-Age=0";
  mocks.session = { userId: "u1" };
  mocks.profile.mockResolvedValue({
    userId: "u1",
    nickname: "라테한잔",
    loginMethod: "email",
  });
  mocks.logout.mockResolvedValue(undefined);
  mocks.withdraw.mockResolvedValue(undefined);
  mocks.contact.mockResolvedValue(undefined);
  mocks.marketing.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({});
  mocks.confirm.mockResolvedValue({ verificationToken: "contact-token" });
});
// 메뉴 버튼으로 확인 창을 열고 창을 돌려준다
async function openDialog(menu: string) {
  fireEvent.click(await screen.findByRole("button", { name: menu }));
  return screen.findByRole("alertdialog");
}
afterEach(cleanup);
async function verifyContact(email = "contact@example.com") {
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
  fireEvent.change(await screen.findByLabelText("인증번호"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await screen.findByText("인증했어요.");
}
it("shows contact email field validation and permits correction", async () => {
  mocks.contact.mockRejectedValueOnce(
    new ApiError("http", "bad request", {
      status: 400,
      problem: {
        status: 400,
        errors: [
          { field: "body", reason: "body error" },
          { field: "email", reason: "연락용 이메일 형식을 확인해 주세요." },
        ],
      },
    }),
  );
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
  await verifyContact();
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  expect(
    await screen.findByText("연락용 이메일 형식을 확인해 주세요."),
  ).toBeTruthy();
  const email = screen.getByLabelText("이메일") as HTMLInputElement;
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(email.readOnly).toBe(false);
  expect(email.value).toBe("contact@example.com");
  expect(
    screen
      .getByRole("button", { name: "이메일 저장" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByText("body error")).toBeNull();
  await verifyContact("fixed@example.com");
  expect(screen.queryByText("연락용 이메일 형식을 확인해 주세요.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  await waitFor(() =>
    expect(mocks.contact).toHaveBeenNthCalledWith(
      2,
      "fixed@example.com",
      "contact-token",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it.each(["body", "agreed"])(
  "shows a generic contact save error for %s without resetting verification",
  async (field) => {
    mocks.contact.mockRejectedValueOnce(
      new ApiError("http", "bad request", {
        status: 400,
        problem: {
          status: 400,
          errors: [{ field, reason: "raw validation error" }],
        },
      }),
    );
    render(<MyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
    await verifyContact();
    fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "연락받을 이메일을 저장하지 못했어요. 다시 시도해 주세요.",
    );
    expect(screen.queryByText("raw validation error")).toBeNull();
    expect(screen.getByText("인증했어요.")).toBeTruthy();
    expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
      true,
    );
  },
);
it.each(["agreed", "body"])(
  "keeps marketing validation failures in a toast (%s)",
  async (field) => {
    mocks.marketing.mockRejectedValueOnce(
      new ApiError("http", "bad request", {
        status: 400,
        problem: {
          status: 400,
          errors: [{ field, reason: "raw marketing error" }],
        },
      }),
    );
    render(<MyPage />);
    const checkbox = await screen.findByRole("checkbox", {
      name: "마케팅 정보 수신 동의 (선택)",
    });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "수신 동의를 변경하지 못했어요. 다시 시도해 주세요.",
      ),
    );
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("raw marketing error")).toBeNull();
  },
);
it("changes an existing contact email only after verification and saving", async () => {
  mocks.profile.mockResolvedValue({
    userId: "u1",
    nickname: "name",
    loginMethod: "google",
    contactEmail: "old@example.com",
    marketingAgreed: false,
  });
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "이메일 변경" }));
  expect((screen.getByLabelText("이메일") as HTMLInputElement).value).toBe(
    "old@example.com",
  );
  expect(
    screen
      .getByRole("button", { name: "이메일 저장" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await verifyContact("changed@example.com");
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  await waitFor(() =>
    expect(mocks.contact).toHaveBeenCalledWith(
      "changed@example.com",
      "contact-token",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("changed@example.com")).toBeTruthy();
  expect(screen.queryByText("old@example.com")).toBeNull();
});
it("requires verification again and clears the token error after successful verification", async () => {
  mocks.contact.mockRejectedValueOnce(
    new ApiError("http", "invalid", {
      status: 400,
      problem: {
        status: 400,
        type: "urn:fitdining:auth:verification-required",
      },
    }),
  );
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
  await verifyContact();
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "이메일 인증이 만료됐어요. 다시 인증해 주세요.",
  );
  expect(
    screen
      .getByRole("button", { name: "이메일 저장" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
    false,
  );
  expect(screen.queryByText("인증했어요.")).toBeNull();
  await verifyContact();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.request).toHaveBeenCalledTimes(2);
  expect(mocks.contact).toHaveBeenCalledTimes(2);
});
it.each([
  new ApiError("network", "서버에 연결하지 못했습니다"),
  new ApiError("http", "server", { status: 503 }),
])(
  "retains verification after a temporary contact save failure: %s",
  async (cause) => {
    mocks.contact.mockRejectedValueOnce(cause);
    render(<MyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
    await verifyContact();
    fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
    expect(screen.getByText("인증했어요.")).toBeTruthy();
    expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
      true,
    );
    expect(
      screen
        .getByRole("button", { name: "이메일 저장" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.contact).toHaveBeenNthCalledWith(
      2,
      "contact@example.com",
      "contact-token",
    );
  },
);
it("clears a general save error only after re-verification succeeds", async () => {
  mocks.contact.mockRejectedValueOnce(
    new ApiError("http", "server", { status: 503 }),
  );
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
  await verifyContact();
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  const message = "연락받을 이메일을 저장하지 못했어요. 다시 시도해 주세요.";
  expect(await screen.findByText(message)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이메일 바꾸기" }));
  expect(screen.getByText(message)).toBeTruthy();
  await verifyContact("changed@example.com");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "이메일 저장" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(mocks.contact).toHaveBeenCalledTimes(1);
});
it("registers a missing contact email after verification", async () => {
  render(<MyPage />);
  fireEvent.click(await screen.findByRole("button", { name: "이메일 등록" }));
  expect(screen.getByText("연락받을 이메일을 등록해 주세요")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "contact@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
  fireEvent.change(await screen.findByLabelText("인증번호"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await screen.findByText("인증했어요.");
  fireEvent.click(screen.getByRole("button", { name: "이메일 저장" }));
  await waitFor(() =>
    expect(mocks.contact).toHaveBeenCalledWith(
      "contact@example.com",
      "contact-token",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("contact@example.com")).toBeTruthy();
  expect(mocks.request).toHaveBeenCalledWith("contact@example.com", "contact");
});
it("shows contact email and updates marketing consent only after success", async () => {
  mocks.profile.mockResolvedValue({
    userId: "u1",
    nickname: "name",
    loginMethod: "google",
    contactEmail: "saved@example.com",
    marketingAgreed: true,
  });
  render(<MyPage />);
  expect(await screen.findByText("saved@example.com")).toBeTruthy();
  const toggle = screen.getByRole("checkbox", {
    name: "마케팅 정보 수신 동의 (선택)",
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(mocks.marketing).toHaveBeenCalledWith(false));
  await waitFor(() =>
    expect(toggle.getAttribute("aria-checked")).toBe("false"),
  );
  mocks.marketing.mockRejectedValueOnce(new Error("failed"));
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      "수신 동의를 변경하지 못했어요. 다시 시도해 주세요.",
    ),
  );
  expect(toggle.getAttribute("aria-checked")).toBe("false");
});
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
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
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
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.router.replace).not.toHaveBeenCalledWith("/login");
  expect(mocks.toast).toHaveBeenCalledWith("탈퇴했어요");
  // 이동이 끝나기 전까지 모달은 막힌 채로 남고, 다시 눌러도 요청하지 않는다
  expect(confirm.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(confirm);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(mocks.withdraw).toHaveBeenCalledTimes(1);
});
// 비회원으로 쓰다 가입한 사람도 탈퇴하면 처음 온 사람처럼 홈(/)에서 온보딩을 본다
it("withdrawing also ends guest mode so home shows onboarding", async () => {
  startAsGuest();
  localStorage.setItem(GUEST_KEY, "1");
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  fireEvent.click(within(dialog).getByRole("button", { name: "탈퇴" }));
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/"));
  expect(isGuest()).toBe(false);
  // 옛 비회원 값이 남아 있으면 홈이 다시 비회원으로 옮긴다
  expect(migrateLegacyGuest()).toBe(false);
});
it("keeps guest mode when withdrawing fails", async () => {
  startAsGuest();
  mocks.withdraw.mockRejectedValue(
    new ApiError("http", "server", { status: 503 }),
  );
  render(<MyPage />);
  const dialog = await openDialog("탈퇴하기");
  fireEvent.click(within(dialog).getByRole("button", { name: "탈퇴" }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  expect(isGuest()).toBe(true);
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
