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
const mocks = vi.hoisted(() => ({ signup: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({
  socialSignup: mocks.signup,
  AuthError: ApiError,
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);
function form() {
  render(
    <ToastProvider>
      <SocialSignupPage />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText("닉네임"), {
    target: { value: "새이름" },
  });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}
async function submit() {
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
}
it("validates nickname before opening terms", () => {
  render(
    <ToastProvider>
      <SocialSignupPage />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "a" } });
  fireEvent.blur(screen.getByLabelText("닉네임"));
  expect(
    screen.getByRole("button", { name: "다음" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("requires agreements and navigates home on success", async () => {
  mocks.signup.mockResolvedValue({});
  form();
  expect(
    (
      await screen.findByRole("button", { name: "동의하고 시작하기" })
    ).hasAttribute("disabled"),
  ).toBe(true);
  await submit();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  expect(mocks.signup).toHaveBeenCalledWith({
    nickname: "새이름",
    agreements: { ageOver14: true, terms: true, privacy: true },
  });
});
it.each([401, 409])("handles status %s", async (status) => {
  mocks.signup.mockRejectedValue(
    new ApiError("http", "failed", {
      status,
      problem: { status, type: "urn:fitdining:auth:nickname-taken" },
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
    expect(screen.getByLabelText("닉네임").getAttribute("aria-invalid")).toBe(
      "true",
    );
  }
});

it("sends onboarding answers and clears them only after successful signup", async () => {
  const answers = {
    mood: "QUIET" as const,
    priorities: [],
    purposes: [],
    tastes: [],
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
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  expect(sessionStorage.getItem(ANSWERS_KEY)).toBeNull();
});
it("keeps onboarding answers when signup fails", async () => {
  const answers = { mood: null, priorities: [], purposes: [], tastes: [] };
  writeAnswers(answers);
  mocks.signup.mockRejectedValue(
    new ApiError("http", "failed", { status: 409 }),
  );
  form();
  await submit();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(readAnswers()).toEqual(answers);
});
