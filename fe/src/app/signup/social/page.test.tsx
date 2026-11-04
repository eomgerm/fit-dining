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
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  socialSignup: mocks.signup,
  AuthError: ApiError,
}));
beforeEach(() => {
  vi.clearAllMocks();
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
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
}
it("opens terms immediately without a nickname input and can reopen", async () => {
  form();
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
it("requires agreements and navigates to location guidance on success", async () => {
  mocks.signup.mockResolvedValue({});
  form();
  expect(
    (
      await screen.findByRole("button", { name: "동의하고 시작하기" })
    ).hasAttribute("disabled"),
  ).toBe(true);
  await submit();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.signup).toHaveBeenCalledWith({
    agreements: { ageOver14: true, terms: true, privacy: true },
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
