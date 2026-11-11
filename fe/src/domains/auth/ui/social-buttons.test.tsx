// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearSignedIn, isMarkedSignedIn } from "../model/signed-in-cookie";
import { SocialButtons } from "./social-buttons";
afterEach(() => {
  cleanup();
  clearSignedIn();
  vi.restoreAllMocks();
});
it.each(["login", "signup"] as const)(
  "uses full-page provider links from %s",
  (from) => {
    render(<SocialButtons from={from} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ["kakao", "google"].map(
        (provider) => `/api/auth/oauth/${provider}?from=${from}`,
      ),
    );
    expect(links.map((link) => link.textContent)).toEqual([
      "카카오로 계속하기",
      "구글로 계속하기",
    ]);
    expect(
      screen.queryByRole("link", { name: "네이버로 계속하기" }),
    ).toBeNull();
  },
);

// 기존 회원은 BE가 바로 홈(/)으로 보낸다. 그 첫 요청이 검색 홈을 받도록 표시를 10분 남긴다
it("누르면 로그인 표시를 10분 남긴다", () => {
  const set = vi.spyOn(document, "cookie", "set");
  render(<SocialButtons from="login" />);
  const link = screen.getByRole("link", { name: "카카오로 계속하기" });
  // jsdom은 페이지 이동을 하지 않는다
  link.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(link);

  expect(isMarkedSignedIn()).toBe(true);
  // 누른 시각과 쿠키를 쓰는 시각 사이에 1초 미만이 지날 수 있다
  expect(set).toHaveBeenCalledWith(expect.stringMatching(/Max-Age=(599|600);/));
});
