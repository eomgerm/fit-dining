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
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/overlay/toast";
import { ANSWERS_KEY, GUEST_KEY } from "@/domains/onboarding/model/storage";
import SignupPage from "./page";

vi.mock("@/shared/ui/display/carousel", () => ({
  Carousel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
afterEach(cleanup);
it.each([
  ["이용약관", "서비스 이용약관"],
  ["개인정보처리방침", "개인정보처리방침"],
])(
  "비회원 안내의 %s 버튼으로 중첩 모달을 열고 복귀한다",
  async (label, title) => {
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
    expect(within(modal).getByText("약관 본문은 준비 중이에요.")).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: title })).toBeNull(),
    );
    expect(screen.getByRole("alertdialog")).toBe(dialog);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.hasAttribute("href")).toBe(false);
    expect(
      screen.getByRole("link", { name: "가입 없이 시작" }).getAttribute("href"),
    ).toBe("/");
  },
);

it("가입 없이 시작하면 답변을 지우고 비회원 표시만 저장한다", async () => {
  sessionStorage.setItem(ANSWERS_KEY, "private answers");
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
  expect(sessionStorage.getItem(ANSWERS_KEY)).toBeNull();
  expect(localStorage.getItem(GUEST_KEY)).toBe("1");
});
