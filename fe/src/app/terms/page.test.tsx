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

it("조 제목과 본문, 시행일을 표시한다", () => {
  render(<TermsPage />);
  expect(
    screen.getByRole("heading", { level: 1, name: "서비스 이용약관" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "제1조 (목적)" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "제10조 (약관 변경)" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "부칙" })).toBeTruthy();
  // 제8조: 탈퇴는 문의처로 요청하고, 리뷰는 장소 상세에서 지운다
  expect(
    screen.getByText(/개인정보처리방침의 문의처로 탈퇴를 요청할 수 있습니다/),
  ).toBeTruthy();
  expect(
    screen.getByText(/장소 상세 화면의 내 리뷰에서 직접 삭제/),
  ).toBeTruthy();
  expect(
    screen.getByText("이 약관은 2026년 11월 11일부터 시행합니다."),
  ).toBeTruthy();
  expect(screen.queryByText("약관 본문은 준비 중이에요.")).toBeNull();
  expect(screen.getByText("2026-11-11").getAttribute("datetime")).toBe(
    "2026-11-11",
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
