// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { ToastProvider } from "@/shared/ui/overlay/toast";
import {
  ANSWERS_KEY,
  writeAnswers,
  readAnswers,
} from "@/domains/onboarding/model/storage";
import SignupEmailPage from "./page";

const mocks = vi.hoisted(() => ({
  signup: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  signup: mocks.signup,
  requestEmailVerification: mocks.requestEmailVerification,
  confirmEmailVerification: mocks.confirmEmailVerification,
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.requestEmailVerification.mockResolvedValue({
    expiresAt: "2026-11-03T00:10:00Z",
    resendAvailableAt: "2026-11-03T00:01:00Z",
  });
  mocks.confirmEmailVerification.mockResolvedValue({
    verificationToken: "verified-token",
    expiresAt: "2026-11-03T00:30:00Z",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("링크 버튼에 nativeButton 경고가 없다", () => {
  const error = vi.spyOn(console, "error");
  const warn = vi.spyOn(console, "warn");
  try {
    render(
      <ToastProvider>
        <SignupEmailPage />
      </ToastProvider>,
    );
    expect(
      screen
        .getByRole("link", { name: "회원가입으로 돌아가기" })
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
function renderPage() {
  render(
    <ToastProvider>
      <SignupEmailPage />
    </ToastProvider>,
  );
}
async function verifyEmail(email = "new@example.com") {
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
function fillRest() {
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText("닉네임"), {
    target: { value: "새이름" },
  });
}
async function form() {
  renderPage();
  await verifyEmail();
  fillRest();
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}
it("requires all agreements, submits once, and navigates to location guidance", async () => {
  let complete!: () => void;
  mocks.signup.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  await form();
  const submit = await screen.findByRole("button", {
    name: "동의하고 시작하기",
  });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(mocks.signup).toHaveBeenCalledTimes(1);
  expect(mocks.signup).toHaveBeenCalledWith({
    email: "new@example.com",
    password: "password1",
    nickname: "새이름",
    agreements: { ageOver14: true, terms: true, privacy: true },
    verificationToken: "verified-token",
  });
  complete();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});
it("closes the sheet and shows duplicate email beside its field", async () => {
  mocks.signup.mockRejectedValue(
    new ApiError("http", "conflict", {
      status: 409,
      problem: { status: 409, type: "urn:fitdining:auth:email-taken" },
    }),
  );
  await form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  expect(await screen.findByText("사용 중인 이메일입니다.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("이메일").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
  const next = screen.getByRole("button", { name: "다음" });
  expect(next.hasAttribute("disabled")).toBe(true);
  fireEvent.blur(screen.getByLabelText("이메일"));
  fireEvent.change(screen.getByLabelText("닉네임"), {
    target: { value: "다른이름" },
  });
  fireEvent.blur(screen.getByLabelText("닉네임"));
  expect(screen.getByText("사용 중인 이메일입니다.")).toBeTruthy();
  expect(next.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "changed@example.com" },
  });
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
  expect(screen.queryByText("사용 중인 이메일입니다.")).toBeNull();
  // 바꾼 이메일은 다시 인증해야 [다음]이 켜진다
  expect(next.hasAttribute("disabled")).toBe(true);
  await verifyEmail("changed@example.com");
  expect(next.hasAttribute("disabled")).toBe(false);
});

it("인증 전에는 [다음]이 꺼져 있고 인증 뒤 이메일 칸을 잠근다", async () => {
  renderPage();
  fillRest();
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "New@Example.com" },
  });
  const next = screen.getByRole("button", { name: "다음" });
  expect(next.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
  expect(
    await screen.findByText(
      "new@example.com로 인증번호를 보냈어요. 메일이 안 보이면 스팸함도 확인해 주세요.",
    ),
  ).toBeTruthy();
  expect(mocks.requestEmailVerification).toHaveBeenCalledWith(
    "new@example.com",
  );
  const code = screen.getByLabelText("인증번호") as HTMLInputElement;
  expect(code.inputMode).toBe("numeric");
  expect(code.autocomplete).toBe("one-time-code");
  expect(screen.getByText("10:00")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /다시 받기/ }).hasAttribute("disabled"),
  ).toBe(true);
  expect(next.hasAttribute("disabled")).toBe(true);
  fireEvent.change(code, { target: { value: "12a3456" } });
  expect(code.value).toBe("123456");
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  await screen.findByText("인증했어요.");
  expect(mocks.confirmEmailVerification).toHaveBeenCalledWith(
    "new@example.com",
    "123456",
  );
  expect(screen.queryByLabelText("인증번호")).toBeNull();
  expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
    true,
  );
  expect(next.hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "이메일 바꾸기" }));
  expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
    false,
  );
  expect(next.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "인증번호 받기" })).toBeTruthy();
});

it.each([
  ["verification-code-mismatch", 400, "인증번호가 맞지 않아요."],
  ["verification-expired", 400, "인증번호가 만료됐어요. 다시 받아 주세요."],
  ["verification-attempts-exceeded", 429, "인증번호를 다시 받아 주세요."],
])(
  "인증번호 확인 실패 %s 문구를 인증번호 칸에 보인다",
  async (type, status, text) => {
    mocks.confirmEmailVerification.mockRejectedValueOnce(
      new ApiError("http", "failed", {
        status,
        problem: { status, type: `urn:fitdining:auth:${type}` },
      }),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
    fireEvent.change(await screen.findByLabelText("인증번호"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByLabelText("인증번호").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "다음" }).hasAttribute("disabled"),
    ).toBe(true);
  },
);

it("이미 가입한 이메일로 인증번호를 요청하면 이메일 칸에 로그인 안내를 보인다", async () => {
  mocks.requestEmailVerification.mockRejectedValueOnce(
    new ApiError("http", "conflict", {
      status: 409,
      problem: { status: 409, type: "urn:fitdining:auth:email-taken" },
    }),
  );
  renderPage();
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "taken@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
  expect(
    await screen.findByText("이미 가입한 이메일이에요. 로그인해 주세요."),
  ).toBeTruthy();
  expect(screen.queryByLabelText("인증번호")).toBeNull();
});

it("가입이 인증 만료로 실패하면 시트를 닫고 인증 단계로 되돌린다", async () => {
  mocks.signup.mockRejectedValueOnce(
    new ApiError("http", "bad input", {
      status: 400,
      problem: {
        status: 400,
        type: "urn:fitdining:auth:verification-required",
      },
    }),
  );
  await form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  expect(
    await screen.findByText("이메일 인증이 만료됐어요. 다시 인증해 주세요."),
  ).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect((screen.getByLabelText("이메일") as HTMLInputElement).readOnly).toBe(
    false,
  );
  expect(
    screen.getByRole("button", { name: "다음" }).hasAttribute("disabled"),
  ).toBe(true);
  await verifyEmail();
  expect(
    screen.queryByText("이메일 인증이 만료됐어요. 다시 인증해 주세요."),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "다음" }).hasAttribute("disabled"),
  ).toBe(false);
});
it("does not show the login link for a field error containing duplicate wording", async () => {
  mocks.signup.mockRejectedValue(
    new ApiError("http", "bad input", {
      status: 400,
      problem: {
        status: 400,
        errors: [
          { field: "email", reason: "이미 가입 안내와 무관한 검증 오류" },
        ],
      },
    }),
  );
  await form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  await screen.findByText("이미 가입 안내와 무관한 검증 오류");
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
});
it("약관 모달을 열고 닫아도 페이지 이동 없이 입력값과 동의 상태를 유지한다", async () => {
  await form();
  await screen.findByRole("button", {
    name: "동의하고 시작하기",
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getAllByRole("button", { name: "보기" })[0]);
  await screen.findByRole("dialog", {
    name: "서비스 이용약관",
  });
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", {
        name: "서비스 이용약관",
      }),
    ).toBeNull(),
  );
  expect(
    screen
      .getByRole("checkbox", { name: "전체 동의" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  for (const [label, value] of [
    ["이메일", "new@example.com"],
    ["비밀번호", "password1"],
    ["비밀번호 확인", "password1"],
    ["닉네임", "새이름"],
  ]) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(
      value,
    );
  }
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.signup).not.toHaveBeenCalled();
});

it("온보딩 답변을 가입 요청에 포함하고 성공하면 지운다", async () => {
  const preferences = {
    mood: "QUIET" as const,
    priorities: ["COZY" as const],
    purposes: [],
    tastes: [
      { polarity: "DISLIKE" as const, label: "매운맛", code: "FOOD_SPICY" },
    ],
  };
  writeAnswers(preferences);
  mocks.signup.mockResolvedValueOnce({ userId: "new-user" });
  await form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
  expect(mocks.signup).toHaveBeenCalledWith(
    expect.objectContaining({ preferences }),
  );
  expect(readAnswers()).toBeUndefined();
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});

it.each(["empty", "blocked"])(
  "%s 저장소에서도 취향 없이 가입을 완료한다",
  async (state) => {
    if (state === "empty") {
      localStorage.setItem(
        ANSWERS_KEY,
        JSON.stringify({
          mood: null,
          priorities: [],
          purposes: [],
          tastes: [],
        }),
      );
    } else {
      for (const method of ["getItem", "setItem", "removeItem"] as const)
        vi.spyOn(Storage.prototype, method).mockImplementation(() => {
          throw new Error("disabled");
        });
    }
    mocks.signup.mockResolvedValueOnce({});
    await form();
    await screen.findByRole("button", { name: "동의하고 시작하기" });
    fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
    fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/location"),
    );
    expect(mocks.signup).toHaveBeenCalledTimes(1);
    expect(mocks.signup.mock.calls[0][0]).not.toHaveProperty("preferences");
  },
);

it("sets input maximum lengths", () => {
  render(
    <ToastProvider>
      <SignupEmailPage />
    </ToastProvider>,
  );
  expect((screen.getByLabelText("이메일") as HTMLInputElement).maxLength).toBe(
    254,
  );
  expect(
    (screen.getByLabelText("비밀번호") as HTMLInputElement).maxLength,
  ).toBe(72);
  expect(
    (screen.getByLabelText("비밀번호 확인") as HTMLInputElement).maxLength,
  ).toBe(72);
  expect((screen.getByLabelText("닉네임") as HTMLInputElement).maxLength).toBe(
    15,
  );
});
