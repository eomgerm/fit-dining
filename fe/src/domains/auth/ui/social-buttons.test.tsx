// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SocialButtons } from "./social-buttons";
afterEach(cleanup);
it.each(["login", "signup"] as const)(
  "uses full-page provider links from %s",
  (from) => {
    render(<SocialButtons from={from} />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      ["kakao", "naver", "google"].map(
        (provider) => `/api/auth/oauth/${provider}?from=${from}`,
      ),
    );
    expect(links.map((link) => link.textContent)).toEqual([
      "카카오로 계속하기",
      "네이버로 계속하기",
      "구글로 계속하기",
    ]);
  },
);
