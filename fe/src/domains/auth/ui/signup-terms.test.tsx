// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SignupTerms } from "./signup-terms";

afterEach(cleanup);
it("약관 보기는 시트 위 모달을 열고 닫으면 시트로 복귀한다", async () => {
  const error = vi.spyOn(console, "error");
  const warn = vi.spyOn(console, "warn");
  try {
    render(
      <SignupTerms
        open
        setOpen={vi.fn()}
        busy={false}
        agreements={{ ageOver14: false, terms: false, privacy: false }}
        setAgreements={vi.fn()}
        start={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "보기" });
    for (const [index, title] of [
      "서비스 이용약관",
      "개인정보처리방침",
    ].entries()) {
      const trigger = buttons[index];
      trigger.focus();
      fireEvent.click(trigger);
      const modal = await screen.findByRole("dialog", { name: title });
      expect(
        within(modal).getByText("약관 본문은 준비 중이에요."),
      ).toBeTruthy();
      expect(within(modal).getByText("2026-10-23")).toBeTruthy();
      expect(within(modal).getByRole("region").className).toContain(
        "overflow-y-auto",
      );
      await waitFor(() =>
        expect(modal.contains(document.activeElement)).toBe(true),
      );
      if (index === 0)
        fireEvent.keyDown(document.activeElement!, {
          key: "Escape",
          code: "Escape",
        });
      else fireEvent.click(within(modal).getByRole("button", { name: "닫기" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: title })).toBeNull(),
      );
      expect(
        screen.getByRole("dialog", { name: "약관에 동의하고 시작해요" }),
      ).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(trigger.hasAttribute("href")).toBe(false);
    }
    expect(
      [...error.mock.calls, ...warn.mock.calls].flat().join(" "),
    ).not.toContain("nativeButton");
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
});
