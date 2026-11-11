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
import { useState } from "react";
import type { Agreements } from "./signup-terms";

afterEach(cleanup);
it("전체 동의는 마케팅을 포함하고 마케팅만 해제해도 가입할 수 있다", () => {
  const start = vi.fn();
  function Form() {
    const [agreements, setAgreements] = useState<Agreements>({
      ageOver14: false,
      terms: false,
      privacy: false,
      marketing: false,
    });
    return (
      <SignupTerms
        open
        setOpen={vi.fn()}
        busy={false}
        agreements={agreements}
        setAgreements={setAgreements}
        start={start}
      />
    );
  }
  render(<Form />);
  const all = screen.getByRole("checkbox", { name: "전체 동의" });
  const marketing = screen.getByRole("checkbox", {
    name: "선택마케팅 정보 수신",
  });
  const submit = screen.getByRole("button", { name: "동의하고 시작하기" });
  fireEvent.click(all);
  expect(all.getAttribute("aria-checked")).toBe("true");
  expect(marketing.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(marketing);
  expect(marketing.getAttribute("aria-checked")).toBe("false");
  expect(all.getAttribute("aria-checked")).toBe("mixed");
  expect(submit.hasAttribute("disabled")).toBe(false);
  fireEvent.click(submit);
  expect(start).toHaveBeenCalledOnce();
});
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
    for (const [index, [title, firstHeading]] of [
      ["서비스 이용약관", "제1조 (목적)"],
      ["개인정보처리방침", "1. 수집하는 항목과 목적"],
    ].entries()) {
      const trigger = buttons[index];
      trigger.focus();
      fireEvent.click(trigger);
      const modal = await screen.findByRole("dialog", { name: title });
      expect(
        within(modal).getByRole("heading", { level: 2, name: title }),
      ).toBeTruthy();
      expect(
        within(modal).getByRole("heading", { level: 3, name: firstHeading }),
      ).toBeTruthy();
      expect(
        within(modal).queryByText("약관 본문은 준비 중이에요."),
      ).toBeNull();
      expect(
        within(modal).getByText("2026-11-11").getAttribute("datetime"),
      ).toBe("2026-11-11");
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
