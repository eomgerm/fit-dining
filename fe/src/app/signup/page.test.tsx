// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/overlay/toast";
import {
  ANSWERS_KEY,
  GUEST_KEY,
  readAnswers,
  writeAnswers,
} from "@/domains/onboarding/model/storage";
import SignupPage from "./page";

vi.mock("@/shared/ui/display/carousel", () => ({
  Carousel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("시안의 제목과 설명 줄 구성을 유지하고 링크 버튼 경고가 없다", () => {
  const error = vi.spyOn(console, "error");
  const warn = vi.spyOn(console, "warn");
  try {
    render(
      <ToastProvider>
        <SignupPage />
      </ToastProvider>,
    );
    const headings = screen.getAllByRole("heading", { level: 2 });
    const lines = [
      [
        "핏다이닝은 변하는 내 취향을 반영해",
        "나에게 “딱” 맞는 곳을 추천해 줘요",
      ],
      ["로그인만 하면 다른 기기에서도", "내 취향이 그대로 반영돼요"],
      ["내 취향에 맞는 장소였나요?", "다음에 방문하기 쉽게 저장해 보세요"],
    ];
    headings.forEach((heading, index) => {
      expect(heading.querySelector("em")?.className).toContain("block");
      const description = heading.nextElementSibling!;
      expect(description.querySelectorAll("br")).toHaveLength(1);
      expect(description.childNodes[0].textContent).toBe(lines[index][0]);
      expect(description.childNodes[2].textContent).toBe(lines[index][1]);
      expect(description.className).toContain("break-keep");
      expect(description.className).not.toContain("px-6");
    });
    expect(
      screen
        .getByRole("link", { name: "이메일로 가입하기" })
        .getAttribute("href"),
    ).toBe("/signup/email");
    expect(
      [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
    ).not.toContain("nativeButton");
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
it.each([
  ["이용약관", "서비스 이용약관"],
  ["개인정보처리방침", "개인정보처리방침"],
])(
  "비회원 안내의 %s 버튼으로 중첩 모달을 열고 복귀한다",
  async (label, title) => {
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    try {
      render(
        <ToastProvider>
          <SignupPage />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain(
        "시작하면 이용약관과 개인정보처리방침에 동의한 것으로 간주해요.",
      );
      const trigger = screen.getByRole("button", { name: label });
      trigger.focus();
      fireEvent.click(trigger);
      const modal = await screen.findByRole("dialog", { name: title });
      expect(
        within(modal).getByText("약관 본문은 준비 중이에요."),
      ).toBeTruthy();
      fireEvent.click(within(modal).getByRole("button", { name: "닫기" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: title })).toBeNull(),
      );
      expect(screen.getByRole("alertdialog")).toBe(dialog);
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(trigger.hasAttribute("href")).toBe(false);
      expect(
        screen
          .getByRole("link", { name: "가입 없이 시작" })
          .getAttribute("href"),
      ).toBe("/location");
      expect(
        [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
      ).not.toContain("nativeButton");
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  },
);

it("가입 없이 시작하면 답변을 유지하고 비회원 표시를 저장한다", async () => {
  const answers = {
    mood: "QUIET" as const,
    priorities: [],
    purposes: [],
    tastes: [],
  };
  writeAnswers(answers);
  render(
    <ToastProvider>
      <SignupPage />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  const link = await screen.findByRole("link", { name: "가입 없이 시작" });
  // Prevent jsdom navigation while keeping the actual click handler.
  link.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(link);
  expect(readAnswers()).toEqual(answers);
  expect(localStorage.getItem(ANSWERS_KEY)).not.toBeNull();
  expect(localStorage.getItem(GUEST_KEY)).toBe("1");
});

it("처음 화면 링크와 가입 제목을 표시한다", () => {
  render(
    <ToastProvider>
      <SignupPage />
    </ToastProvider>,
  );
  expect(
    screen.getByRole("link", { name: "처음 화면으로" }).getAttribute("href"),
  ).toBe("/");
  expect(screen.getByRole("heading", { level: 1 }).className).toContain(
    "sr-only",
  );
  const skip = screen.getByRole("button", { name: "건너뛰기" });
  expect(skip.className).toContain("min-w-18");
  expect(skip.className).toContain("text-ink-muted");
  expect(skip.className).not.toContain("underline");
});
it("비회원 안내에 사람 아이콘을 표시한다", async () => {
  render(
    <ToastProvider>
      <SignupPage />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  const dialog = await screen.findByRole("alertdialog");
  const icon = dialog.querySelector("svg");
  expect(icon?.querySelectorAll("path")).toHaveLength(2);
  expect(icon?.parentElement?.className).toContain("bg-primary-soft");
});
