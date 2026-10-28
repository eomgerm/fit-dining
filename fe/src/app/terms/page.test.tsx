// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TermsPage from "./page";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("지정된 대체 본문과 시행일을 표시한다", () => {
  render(<TermsPage />);
  expect(screen.getByRole("heading", { name: "서비스 이용약관" })).toBeTruthy();
  expect(screen.getByText("약관 본문은 준비 중이에요.")).toBeTruthy();
  expect(screen.getByText("2026-10-23").getAttribute("datetime")).toBe(
    "2026-10-23",
  );
});

it.each([1, 2])("기록 길이가 %i일 때 뒤로가기를 처리한다", (length) => {
  vi.spyOn(window.history, "length", "get").mockReturnValue(length);
  render(<TermsPage />);
  fireEvent.click(screen.getByRole("button", { name: "뒤로가기" }));
  if (length > 1) {
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  } else {
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
  }
});
