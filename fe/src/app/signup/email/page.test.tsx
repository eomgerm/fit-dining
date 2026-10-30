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

const mocks = vi.hoisted(() => ({ signup: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/domains/auth/api/auth-client", () => ({ signup: mocks.signup }));
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
function form() {
  render(
    <ToastProvider>
      <SignupEmailPage />
    </ToastProvider>,
  );
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호"), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), {
    target: { value: "password1" },
  });
  fireEvent.change(screen.getByLabelText("닉네임"), {
    target: { value: "새이름" },
  });
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
  form();
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
  });
  complete();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/location"));
});
it("closes the sheet and shows duplicate email beside its field", async () => {
  mocks.signup.mockRejectedValue(
    new ApiError("http", "conflict", {
      status: 409,
      problem: { status: 409, type: "urn:fitdining:auth:email-taken" },
    }),
  );
  form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  expect(
    await screen.findByText("이미 가입한 이메일이에요. 로그인해 주세요."),
  ).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByLabelText("이메일").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(
    screen.getByRole("link", { name: "로그인하기" }).getAttribute("href"),
  ).toBe("/login");
  fireEvent.change(screen.getByLabelText("이메일"), {
    target: { value: "changed@example.com" },
  });
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
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
  form();
  await screen.findByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(screen.getByRole("checkbox", { name: "전체 동의" }));
  fireEvent.click(screen.getByRole("button", { name: "동의하고 시작하기" }));
  await screen.findByText("이미 가입 안내와 무관한 검증 오류");
  expect(screen.queryByRole("link", { name: "로그인하기" })).toBeNull();
});
it("약관 모달을 열고 닫아도 페이지 이동 없이 입력값과 동의 상태를 유지한다", async () => {
  form();
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
  form();
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
    form();
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
