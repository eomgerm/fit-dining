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
  readAnswers,
  writeAnswers,
} from "@/domains/onboarding/model/storage";
import SocialSignupPage from "./page";
const mocks = vi.hoisted(() => ({
  signup: vi.fn(),
  context: vi.fn(),
  request: vi.fn(),
  confirm: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  socialSignup: mocks.signup,
  getSocialSignup: mocks.context,
  requestEmailVerification: mocks.request,
  confirmEmailVerification: mocks.confirm,
  AuthError: ApiError,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.signup.mockResolvedValue({});
  mocks.context.mockResolvedValue({
    provider: "google",
    email: "social@example.com",
  });
  mocks.request.mockResolvedValue({});
  mocks.confirm.mockResolvedValue({ verificationToken: "contact-token" });
  localStorage.clear();
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
        <SocialSignupPage />
      </ToastProvider>,
    );
    expect(
      screen.getByRole("link", { hidden: true }).getAttribute("href"),
    ).toBe("/signup");
    expect(
      [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
    ).not.toContain("nativeButton");
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
function form() {
  render(
    <ToastProvider>
      <SocialSignupPage />
    </ToastProvider>,
  );
}
async function submit() {
  if (!screen.queryByRole("dialog"))
    fireEvent.click(
      await screen.findByRole("button", {
        name: "\uC57D\uAD00 \uB3D9\uC758\uD558\uACE0 \uC2DC\uC791\uD558\uAE30",
      }),
    );
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
}
it("opens terms after confirming contact email and can reopen", async () => {
  form();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "\uC57D\uAD00 \uB3D9\uC758\uD558\uACE0 \uC2DC\uC791\uD558\uAE30",
    }),
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true),
  );
  expect(screen.queryByLabelText("닉네임")).toBeNull();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: "약관 동의하고 시작하기" }),
  );
  expect(await screen.findByRole("dialog")).toBeTruthy();
});

it.each([null, "provider@example.com"])(
  "requires verification when provider email is %s and edited",
  async (email) => {
    mocks.context.mockResolvedValue({ provider: "google", email });
    form();
    if (email)
      fireEvent.click(await screen.findByRole("button", { name: "변경" }));
    const input = await screen.findByLabelText("이메일");
    expect(
      screen
        .getByRole("button", { name: "약관 동의하고 시작하기" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(input, { target: { value: "contact@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
    fireEvent.change(await screen.findByLabelText("인증번호"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await screen.findByText("인증했어요.");
    expect(mocks.request).toHaveBeenCalledWith(
      "contact@example.com",
      "contact",
    );
    await submit();
    await waitFor(() =>
      expect(mocks.signup).toHaveBeenCalledWith(
        expect.objectContaining({
          contactEmail: "contact@example.com",
          verificationToken: "contact-token",
        }),
      ),
    );
  },
);

it("redirects when signup context has expired", async () => {
  mocks.context.mockRejectedValue(
    new ApiError("http", "expired", { status: 401 }),
  );
  form();
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith("/signup?error=social"),
  );
  expect(mocks.signup).not.toHaveBeenCalled();
});

it.each([false, true])(
  "shows contactEmail validation beside an editable input (edited=%s)",
  async (edited) => {
    mocks.signup.mockRejectedValueOnce(
      new ApiError("http", "bad request", {
        status: 400,
        problem: {
          status: 400,
          errors: [
            { field: "body", reason: "body error" },
            {
              field: "contactEmail",
              reason: "연락용 이메일 형식을 확인해 주세요.",
            },
          ],
        },
      }),
    );
    form();
    if (edited) {
      fireEvent.click(await screen.findByRole("button", { name: "변경" }));
      fireEvent.change(screen.getByLabelText("이메일"), {
        target: { value: "edited@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
      fireEvent.change(await screen.findByLabelText("인증번호"), {
        target: { value: "123456" },
      });
      fireEvent.click(screen.getByRole("button", { name: "확인" }));
      await screen.findByText("인증했어요.");
    }
    await submit();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      await screen.findByText("연락용 이메일 형식을 확인해 주세요."),
    ).toBeTruthy();
    const email = screen.getByLabelText("이메일") as HTMLInputElement;
    expect(email.value).toBe(
      edited ? "edited@example.com" : "social@example.com",
    );
    expect(email.readOnly).toBe(false);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "약관 동의하고 시작하기" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByText("body error")).toBeNull();
    fireEvent.change(email, { target: { value: "fixed@example.com" } });
    expect(
      screen.queryByText("연락용 이메일 형식을 확인해 주세요."),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "인증번호 받기" }));
    fireEvent.change(await screen.findByLabelText("인증번호"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await screen.findByText("인증했어요.");
    fireEvent.click(
      screen.getByRole("button", { name: "약관 동의하고 시작하기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "동의하고 시작하기" }),
    );
    await waitFor(() =>
      expect(mocks.signup).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          contactEmail: "fixed@example.com",
          verificationToken: "contact-token",
        }),
      ),
    );
  },
);

it("accepts an old signup cookie with email:null and requires manual verification", async () => {
  mocks.context.mockResolvedValueOnce({ provider: "google", email: null });
  form();
  expect(await screen.findByLabelText("이메일")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "약관 동의하고 시작하기" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("button", { name: "취소" })).toBeNull();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(mocks.signup).not.toHaveBeenCalled();
});

it.each([
  new ApiError("network", "offline"),
  new ApiError("http", "server", { status: 503 }),
])(
  "replaces loading with an error and retries signup context: %s",
  async (cause) => {
    mocks.context.mockRejectedValueOnce(cause);
    form();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "가입 정보를 불러오지 못했어요. 다시 시도해 주세요.",
    );
    expect(screen.queryByText("가입 정보를 불러오고 있어요")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "약관 동의하고 시작하기" })
        .hasAttribute("disabled"),
    ).toBe(true);
    let finish!: (value: { provider: string; email: string }) => void;
    mocks.context.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("가입 정보를 불러오고 있어요")).toBeTruthy();
    finish({ provider: "google", email: "retry@example.com" });
    expect(await screen.findByText("retry@example.com")).toBeTruthy();
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(
      screen
        .getByRole("button", { name: "약관 동의하고 시작하기" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);

it("returns to verification after signup requires a new token", async () => {
  mocks.signup.mockRejectedValueOnce(
    new ApiError("http", "invalid", {
      status: 400,
      problem: {
        status: 400,
        type: "urn:fitdining:auth:verification-required",
      },
    }),
  );
  form();
  await submit();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByLabelText("이메일")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe(
    "이메일 인증이 만료됐어요. 다시 인증해 주세요.",
  );
  expect(
    screen
      .getByRole("button", { name: "약관 동의하고 시작하기" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("redirects when the signup POST session expires", async () => {
  mocks.signup.mockRejectedValueOnce(
    new ApiError("http", "expired", { status: 401 }),
  );
  form();
  await submit();
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith("/signup?error=social"),
  );
  expect(mocks.signup).toHaveBeenCalledTimes(1);
});

it("cancels an email change and signs up with the provider email without a token", async () => {
  form();
  fireEvent.click(await screen.findByRole("button", { name: "변경" }));
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "changed@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.queryByLabelText("이메일")).toBeNull();
  expect(screen.getByText("social@example.com")).toBeTruthy();
  await submit();
  await waitFor(() =>
    expect(mocks.signup).toHaveBeenCalledWith(
      expect.objectContaining({ contactEmail: "social@example.com" }),
    ),
  );
  expect(mocks.signup.mock.calls[0][0]).not.toHaveProperty("verificationToken");
  expect(mocks.request).not.toHaveBeenCalled();
});

it("allows signup without marketing consent", async () => {
  form();
  fireEvent.click(
    await screen.findByRole("button", { name: "약관 동의하고 시작하기" }),
  );
  for (const name of [
    "필수만 14세 이상이에요",
    "필수서비스 이용약관",
    "필수개인정보 수집·이용",
  ])
    fireEvent.click(screen.getByRole("checkbox", { name }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  await waitFor(() =>
    expect(mocks.signup).toHaveBeenCalledWith(
      expect.objectContaining({
        agreements: {
          ageOver14: true,
          terms: true,
          privacy: true,
          marketing: false,
        },
      }),
    ),
  );
});
it("requires agreements and navigates to location guidance on success", async () => {
  mocks.signup.mockResolvedValue({});
  form();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "\uC57D\uAD00 \uB3D9\uC758\uD558\uACE0 \uC2DC\uC791\uD558\uAE30",
    }),
  );
  expect(
    (
      await screen.findByRole("button", { name: "동의하고 시작하기" })
    ).hasAttribute("disabled"),
  ).toBe(true);
  await submit();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.signup).toHaveBeenCalledWith({
    agreements: {
      ageOver14: true,
      terms: true,
      privacy: true,
      marketing: true,
    },
    contactEmail: "social@example.com",
  });
});
it.each([401, 500])("handles status %s", async (status) => {
  mocks.signup.mockRejectedValue(
    new ApiError("http", "failed", {
      status,
      problem: { status, type: "about:blank" },
    }),
  );
  form();
  await submit();
  if (status === 401)
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/signup?error=social"),
    );
  else {
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  }
});

it("sends onboarding answers and clears them only after successful signup", async () => {
  const answers = {
    mood: "QUIET" as const,
    priorities: [],
    purposes: [],
    tastes: [
      { polarity: "DISLIKE" as const, label: "매운맛", code: "FOOD_SPICY" },
    ],
  };
  writeAnswers(answers);
  let finish!: () => void;
  mocks.signup.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  form();
  await submit();
  await waitFor(() =>
    expect(mocks.signup).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: answers }),
    ),
  );
  expect(readAnswers()).toEqual(answers);
  finish();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});
it("keeps onboarding answers when signup fails", async () => {
  const answers = {
    mood: "QUIET" as const,
    priorities: [],
    purposes: [],
    tastes: [],
  };
  writeAnswers(answers);
  mocks.signup.mockRejectedValue(
    new ApiError("http", "failed", { status: 409 }),
  );
  form();
  await submit();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(readAnswers()).toEqual(answers);
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
    form();
    await submit();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/location"),
    );
    expect(mocks.signup).toHaveBeenCalledTimes(1);
    expect(mocks.signup.mock.calls[0][0]).not.toHaveProperty("preferences");
  },
);
