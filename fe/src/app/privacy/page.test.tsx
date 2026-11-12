// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PrivacyPage from "./page";

const router = vi.hoisted(() => ({ back: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("절 제목과 본문, 시행일을 표시한다", () => {
  render(<PrivacyPage />);
  expect(
    screen.getByRole("heading", { level: 1, name: "개인정보처리방침" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "1. 수집하는 항목과 목적" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 2, name: "9. 변경" }),
  ).toBeTruthy();
  // 1절 표는 구분마다 항목·목적을 나열한다
  expect(screen.getByText("이메일 가입")).toBeTruthy();
  expect(
    screen.getByText(
      "소셜 서비스 이름, 소셜 회원 번호, 이메일(소셜 계정에서 받거나 직접 입력. 연락용 이메일이 없는 기존 회원은 로그인할 때 소셜 계정에서 받은 이메일로 등록)",
    ),
  ).toBeTruthy();
  expect(screen.getByText("마케팅 수신(선택)")).toBeTruthy();
  expect(screen.getByText("연락용 이메일, 동의 시각")).toBeTruthy();
  expect(
    screen.getByText(/연락용 이메일·마케팅 동의 기록: 탈퇴 시 즉시 삭제/),
  ).toBeTruthy();
  expect(
    screen.getByText("이메일, 비밀번호(암호화된 값만 저장), 닉네임"),
  ).toBeTruthy();
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
    Array.from({ length: 8 }, () => ["항목", "목적"]).flat(),
  );
  // 직접 입력 기록은 비회원도 남고, 회원과 연결하지 않아 탈퇴와 무관하게 90일 보관한다
  expect(screen.getByText("취향 직접 입력 기록")).toBeTruthy();
  expect(
    screen.getByText(
      "취향 직접 입력 기록: 90일(회원 정보와 연결하지 않아 탈퇴해도 90일 동안 보관)",
    ),
  ).toBeTruthy();
  expect(screen.getByText("이메일: brightrain453@gmail.com")).toBeTruthy();
  // 2절: 리뷰 작성 전 근처 확인 용도, 7절: 탈퇴는 연락처로 요청
  expect(
    screen.getByText(
      /거리 계산과 근처 확인에만 쓰며 서버로 보내거나 저장하지 않습니다/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(/탈퇴와 그 밖의 열람·정정·삭제 요청은 아래 연락처로/),
  ).toBeTruthy();
  expect(screen.queryByText("약관 본문은 준비 중이에요.")).toBeNull();
  expect(screen.getByText("2026-11-11").getAttribute("datetime")).toBe(
    "2026-11-11",
  );
});

it.each([1, 2])("기록 길이가 %i일 때 뒤로가기를 처리한다", (length) => {
  vi.spyOn(window.history, "length", "get").mockReturnValue(length);
  render(<PrivacyPage />);
  fireEvent.click(screen.getByRole("button", { name: "뒤로가기" }));
  if (length > 1) {
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.replace).not.toHaveBeenCalled();
  } else {
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
  }
});
